import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../../prisma/prisma.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { BounceParserService } from './bounce-parser.service';
import { MailboxState, MailboxType, LeadStatus, ReplyCategory } from '@prisma/client';

@Injectable()
export class InboundSyncService {
  private readonly logger = new Logger(InboundSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailboxesService: MailboxesService,
    private readonly bounceParser: BounceParserService,
  ) {}

  /**
   * Periodically poll inboxes every 2 minutes for inbound messages
   */
  @Cron('*/2 * * * *')
  async pollInboundMail() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      await this.syncAllMailboxes();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Synchronize all active or warming SMTP_IMAP mailboxes
   */
  async syncAllMailboxes(): Promise<{ processedMailboxes: number; totalNewReplies: number; errors: string[] }> {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: {
        state: { in: [MailboxState.ACTIVE, MailboxState.WARMING] },
        type: MailboxType.SMTP_IMAP,
      },
    });

    let totalNewReplies = 0;
    const errors: string[] = [];

    for (const mailbox of mailboxes) {
      try {
        const count = await this.syncMailbox(mailbox);
        totalNewReplies += count;
      } catch (err: any) {
        const errMsg = `IMAP sync failed for mailbox ${mailbox.email}: ${err.message}`;
        this.logger.warn(errMsg);
        errors.push(errMsg);
      }
    }

    return {
      processedMailboxes: mailboxes.length,
      totalNewReplies,
      errors,
    };
  }

  /**
   * Synchronize a single mailbox on-demand by ID
   */
  async syncMailboxById(mailboxId: string): Promise<{ success: boolean; newReplies: number; message?: string }> {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id: mailboxId },
    });

    if (!mailbox) {
      return { success: false, newReplies: 0, message: 'Mailbox not found' };
    }

    if (mailbox.type !== MailboxType.SMTP_IMAP) {
      return { success: false, newReplies: 0, message: 'Mailbox does not support IMAP sync' };
    }

    try {
      const newReplies = await this.syncMailbox(mailbox);
      return { success: true, newReplies };
    } catch (err: any) {
      return { success: false, newReplies: 0, message: err.message };
    }
  }

  private async syncMailbox(mailbox: any): Promise<number> {
    const config = await this.mailboxesService.getDecryptedConfig(mailbox.id);
    if (!config?.imapHost) return 0;

    const isSecure = config.imapPort === 993 || config.imapSecurity === 'ssl';
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort || 993,
      secure: isSecure,
      auth: {
        user: config.imapUser || config.smtpUser,
        pass: config.imapPass || config.smtpPass,
      },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      tls: {
        rejectUnauthorized: false,
      },
    });

    client.on('error', (err: any) => {
      this.logger.warn(`IMAP client socket error for ${mailbox.email}: ${err?.message || err}`);
    });

    let newRepliesCount = 0;

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        if (!client.mailbox || client.mailbox.exists === 0) {
          return 0;
        }

        // 1. Search for unseen messages
        let unseenUids: number[] = [];
        try {
          const res = await client.search({ seen: false }, { uid: true });
          if (Array.isArray(res)) unseenUids = res;
        } catch (searchErr: any) {
          this.logger.debug(`Could not search unseen messages for ${mailbox.email}: ${searchErr.message}`);
        }

        // 2. Search for recent messages (past 7 days)
        let recentUids: number[] = [];
        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const res = await client.search({ since: sevenDaysAgo }, { uid: true });
          if (Array.isArray(res)) recentUids = res;
        } catch (searchErr: any) {
          this.logger.debug(`Could not search recent messages for ${mailbox.email}: ${searchErr.message}`);
        }

        // 3. Fallback: if search returned no UIDs, inspect the latest 30 sequence messages in INBOX
        if (unseenUids.length === 0 && recentUids.length === 0 && client.mailbox.exists > 0) {
          const startSeq = Math.max(1, client.mailbox.exists - 29);
          try {
            const res = await client.search({ seq: `${startSeq}:*` }, { uid: true });
            if (Array.isArray(res)) recentUids = res;
          } catch {
            // ignore fallback error
          }
        }

        // Combine, deduplicate, and order ascending
        const combinedUids = Array.from(new Set([...unseenUids, ...recentUids])).sort((a, b) => a - b);
        // Take at most the latest 50 messages to keep memory and execution bounded
        const targetUids = combinedUids.slice(-50);

        if (targetUids.length === 0) {
          return 0;
        }

        // Fetch messages into memory first to avoid IMAP socket command deadlocks
        const fetchedMessages: any[] = [];
        const uidRange = targetUids.join(',');

        for await (const message of client.fetch(uidRange, { source: true, uid: true, flags: true }, { uid: true })) {
          if (message.source) {
            fetchedMessages.push(message);
          }
        }

        // Process fetched messages safely outside the generator loop
        for (const message of fetchedMessages) {
          try {
            const parsed = await simpleParser(message.source);
            const saved = await this.processIncomingEmail(mailbox, parsed);
            if (saved) {
              newRepliesCount++;
            }
          } catch (msgErr: any) {
            this.logger.warn(`Error processing message UID ${message.uid} for ${mailbox.email}: ${msgErr.message}`);
          }
        }

        // Update mailbox lastSyncAt
        await this.prisma.mailbox.update({
          where: { id: mailbox.id },
          data: { lastSyncAt: new Date() },
        });
      } finally {
        try {
          lock.release();
        } catch (lockErr: any) {
          this.logger.debug(`Could not release lock for ${mailbox.email}: ${lockErr?.message}`);
        }
      }
    } finally {
      try {
        if (client.usable) {
          await client.logout();
        } else {
          client.close();
        }
      } catch (closeErr: any) {
        this.logger.debug(`Could not close IMAP client for ${mailbox.email}: ${closeErr?.message}`);
      }
    }

    return newRepliesCount;
  }

  private async processIncomingEmail(mailbox: any, parsed: any): Promise<boolean> {
    const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase()?.trim();
    if (!fromEmail) return false;

    // Ignore self-sent emails from this mailbox
    if (fromEmail === mailbox.email.toLowerCase().trim()) return false;

    const subject = parsed.subject || '(No Subject)';
    const bodyText = parsed.text || '';
    const bodyHtml = parsed.html || parsed.textAsHtml || '';
    const receivedAt = parsed.date ? new Date(parsed.date) : new Date();

    // Check headers for In-Reply-To and References
    const inReplyTo = parsed.inReplyTo?.replace(/[<>]/g, '');
    const references = parsed.references
      ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).map(
          (r: string) => r.replace(/[<>]/g, ''),
        )
      : [];

    const candidateMessageIds = [inReplyTo, ...references].filter(Boolean);

    // 1. Check if message is a Bounce (DSN)
    const bounce = this.bounceParser.classifyBounce(
      subject,
      bodyText,
      parsed.headers,
    );

    if (bounce.isBounce) {
      await this.bounceParser.processBounceEvent(bounce);
      return false;
    }

    // 2. Correlate with Outbound EmailLog
    let emailLog = candidateMessageIds.length > 0
      ? await this.prisma.emailLog.findFirst({
          where: { messageId: { in: candidateMessageIds } },
        })
      : null;

    // Fallback: match by prospect email address
    if (!emailLog) {
      emailLog = await this.prisma.emailLog.findFirst({
        where: {
          lead: { email: fromEmail },
          mailboxId: mailbox.id,
          status: { in: ['SENT', 'DELIVERED'] },
        },
        orderBy: { sentAt: 'desc' },
      });
    }

    // Fallback timestamp guard: If matching by email without RFC2822 In-Reply-To/References,
    // verify the inbound email was actually received AFTER the campaign email was sent!
    if (candidateMessageIds.length === 0 && emailLog?.sentAt && parsed.date) {
      const emailSentTime = new Date(emailLog.sentAt).getTime();
      const replyTime = new Date(parsed.date).getTime();
      if (replyTime < emailSentTime) {
        // Message was received before this campaign email was sent: ignore as historical email
        return false;
      }
    }

    // Check if this exact reply has already been saved to avoid duplicates
    const duplicateReply = await this.prisma.inboundReply.findFirst({
      where: {
        mailboxId: mailbox.id,
        fromEmail,
        subject,
        OR: [
          {
            receivedAt: {
              gte: new Date(receivedAt.getTime() - 15 * 60 * 1000),
              lte: new Date(receivedAt.getTime() + 15 * 60 * 1000),
            },
          },
          {
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        ],
      },
    });
    if (duplicateReply) {
      return false;
    }

    // 3. Match Lead or Auto-Provision Inbound Contact
    let lead = emailLog
      ? await this.prisma.lead.findUnique({ where: { id: emailLog.leadId } })
      : await this.prisma.lead.findFirst({ where: { email: fromEmail } });

    if (!lead) {
      let inboundList = await this.prisma.leadList.findFirst({
        where: { isSystem: true, name: 'Inbound Contacts' },
      });

      if (!inboundList) {
        inboundList = await this.prisma.leadList.findFirst();
      }

      if (!inboundList) {
        inboundList = await this.prisma.leadList.create({
          data: {
            name: 'Inbound Contacts',
            description: 'Contacts received via inbound email synchronization',
            isSystem: true,
          },
        });
      }

      const senderRawName = parsed.from?.value?.[0]?.name || '';
      const nameParts = senderRawName.trim().split(/\s+/);
      const firstName = nameParts[0] || fromEmail.split('@')[0];
      const lastName = nameParts.slice(1).join(' ') || undefined;

      lead = await this.prisma.lead.create({
        data: {
          leadListId: inboundList.id,
          email: fromEmail,
          firstName,
          lastName,
          status: LeadStatus.REPLIED,
        },
      });
      this.logger.log(`Created new inbound contact for ${fromEmail} (${lead.id})`);
    }

    // 4. Auto-classify reply sentiment heuristics
    const category = this.detectReplyCategory(subject, bodyText);

    // 5. Store in InboundReply table for Unibox
    await this.prisma.inboundReply.create({
      data: {
        emailLogId: emailLog?.id,
        mailboxId: mailbox.id,
        leadId: lead.id,
        fromEmail,
        toEmail: mailbox.email,
        subject,
        bodyText,
        bodyHtml,
        category,
        receivedAt,
      },
    });

    // 6. Transition lead status to REPLIED and halt pending sequence steps!
    if (lead.status !== LeadStatus.REPLIED) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.REPLIED,
          nextScheduledAt: null, // HALT all future follow-up sequence steps
        },
      });
    }

    this.logger.log(
      `🎉 Inbound reply received from ${fromEmail}. Follow-ups stopped for lead ${lead.id}`,
    );

    return true;
  }

  private detectReplyCategory(subject: string, text: string): ReplyCategory {
    const content = `${subject} ${text}`.toLowerCase();

    if (
      content.includes('out of office') ||
      content.includes('auto-reply') ||
      content.includes('automatic reply') ||
      content.includes('on leave')
    ) {
      return ReplyCategory.OUT_OF_OFFICE;
    }

    if (
      content.includes('unsubscribe') ||
      content.includes('remove me') ||
      content.includes('stop emailing') ||
      content.includes('take me off')
    ) {
      return ReplyCategory.UNSUBSCRIBE;
    }

    if (
      content.includes('interested') ||
      content.includes('lets talk') ||
      content.includes("let's chat") ||
      content.includes('schedule a call') ||
      content.includes('send more info') ||
      content.includes('pricing')
    ) {
      return ReplyCategory.INTERESTED;
    }

    if (
      content.includes('not interested') ||
      content.includes('no thank') ||
      content.includes('not right now') ||
      content.includes('dont contact')
    ) {
      return ReplyCategory.NOT_INTERESTED;
    }

    if (
      content.includes('next quarter') ||
      content.includes('follow up in') ||
      content.includes('reach back') ||
      content.includes('later')
    ) {
      return ReplyCategory.FOLLOW_UP_LATER;
    }

    return ReplyCategory.GENERAL;
  }
}

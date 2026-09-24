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
   * Periodically poll inboxes every 3 minutes for inbound messages
   */
  @Cron('*/3 * * * *')
  async pollInboundMail() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const mailboxes = await this.prisma.mailbox.findMany({
        where: {
          state: { in: [MailboxState.ACTIVE, MailboxState.WARMING] },
          type: MailboxType.SMTP_IMAP, // IMAP credentials available
        },
      });

      for (const mailbox of mailboxes) {
        try {
          await this.syncMailbox(mailbox);
        } catch (err: any) {
          this.logger.warn(`IMAP sync failed for mailbox ${mailbox.email}: ${err.message}`);
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncMailbox(mailbox: any) {
    const config = await this.mailboxesService.getDecryptedConfig(mailbox.id);
    if (!config?.imapHost) return;

    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort || 993,
      secure: config.imapSecurity ? config.imapSecurity === 'ssl' : (config.imapPort === 993),
      auth: {
        user: config.imapUser,
        pass: config.imapPass,
      },
      logger: false,
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 45000,
    });

    // Essential: ImapFlow is an EventEmitter. Without an 'error' event listener,
    // socket timeouts (ETIMEOUT) or connection drops emit an unhandled 'error' event
    // that crashes the entire Node.js server.
    client.on('error', (err: any) => {
      this.logger.warn(`IMAP client socket error for ${mailbox.email}: ${err?.message || err}`);
    });

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        // Fetch unseen messages in INBOX
        for await (const message of client.fetch({ seen: false }, { source: true, uid: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          await this.processIncomingEmail(mailbox, parsed);
          // Mark as seen so IMAP doesn't return it again repeatedly
          try {
            await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
          } catch (flagErr: any) {
            this.logger.debug(`Could not mark message ${message.uid} as seen: ${flagErr.message}`);
          }
        }
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
  }

  private async processIncomingEmail(mailbox: any, parsed: any) {
    const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase();
    if (!fromEmail) return;

    const subject = parsed.subject || '';
    const bodyText = parsed.text || '';
    const bodyHtml = parsed.html || parsed.textAsHtml || '';

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
      return;
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
        return;
      }
    }

    // Check if this exact reply has already been saved to avoid duplicates
    const duplicateReply = await this.prisma.inboundReply.findFirst({
      where: {
        mailboxId: mailbox.id,
        fromEmail,
        subject,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (duplicateReply) {
      return;
    }

    // 3. Match Lead
    const lead = emailLog
      ? await this.prisma.lead.findUnique({ where: { id: emailLog.leadId } })
      : await this.prisma.lead.findFirst({ where: { email: fromEmail } });

    if (!lead) return;

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
      },
    });

    // 6. Transition lead status to REPLIED and halt pending sequence steps!
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.REPLIED,
        nextScheduledAt: null, // HALT all future follow-up sequence steps
      },
    });

    this.logger.log(
      `🎉 Inbound reply received from ${fromEmail}. Follow-ups stopped for lead ${lead.id}`,
    );
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

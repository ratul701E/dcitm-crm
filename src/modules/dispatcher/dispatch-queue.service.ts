import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderAdaptersService } from './provider-adapters.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { PreSendGatekeeperService } from '../suppression/pre-send-gatekeeper.service';
import { TrackingService } from '../tracking/tracking.service';
import { UnsubscribeService } from '../suppression/unsubscribe.service';
import { SpintaxService } from '../spintax/spintax.service';
import { EmailDispatchStatus, LeadStatus } from '@prisma/client';
import * as crypto from 'crypto';

export interface DispatchJobData {
  campaignId: string;
  leadId: string;
  sequenceStepId: string;
  sequenceVariantId: string;
  stepOrder: number;
}

@Injectable()
export class DispatchQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchQueueService.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdaptersService,
    private readonly mailboxesService: MailboxesService,
    private readonly gatekeeper: PreSendGatekeeperService,
    private readonly trackingService: TrackingService,
    private readonly unsubscribeService: UnsubscribeService,
    private readonly spintaxService: SpintaxService,
  ) {}

  private isRedisConnected = false;

  onModuleInit() {
    const connection: any = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      username: this.configService.get<string>('REDIS_USERNAME') || undefined,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
    };

    try {
      this.queue = new Queue('email-dispatch-queue', { connection });
      this.queue.on('error', (err) => {
        this.isRedisConnected = false;
        this.logger.warn(`Redis queue connection warning: ${err.message}`);
      });
      this.queue.waitUntilReady().then(() => {
        this.isRedisConnected = true;
        this.logger.log('Redis queue connection established successfully.');
      }).catch((err: any) => {
        this.isRedisConnected = false;
        this.logger.warn(`Redis client connect error: ${err.message}`);
      });

      this.worker = new Worker(
        'email-dispatch-queue',
        async (job: Job<DispatchJobData>) => {
          await this.processDispatchJob(job.data);
        },
        {
          connection,
          concurrency: 3,
        },
      );
      this.worker.on('error', (err) => {
        this.isRedisConnected = false;
        this.logger.warn(`Redis worker connection warning: ${err.message}`);
      });
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(`Failed to initialize BullMQ (${err.message}). In-memory dispatch active.`);
    }
  }

  /**
   * Schedules an outbound email job with calculated jitter delay
   */
  async enqueueDispatch(data: DispatchJobData, delayMs = 0) {
    if (this.isRedisConnected && this.queue) {
      try {
        await this.queue.add('send-email', data, {
          delay: delayMs,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        });
        return;
      } catch (err: any) {
        this.logger.warn(`BullMQ queue.add failed (${err.message}). Running in-memory fallback.`);
      }
    }

    // Direct in-process execution fallback
    this.logger.log(`Dispatching email in-process (delay: ${delayMs}ms)...`);
    setTimeout(async () => {
      try {
        await this.processDispatchJob(data);
      } catch (err: any) {
        this.logger.error(`In-process dispatch execution failed: ${err.message}`);
      }
    }, delayMs);
  }

  public async processDispatchJob(data: DispatchJobData) {
    const { campaignId, leadId, sequenceStepId, sequenceVariantId, stepOrder } = data;

    // 1. Fetch Lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) return;

    // Check if lead has bounced, unsubscribed, or is suppressed globally
    if (
      lead.status === LeadStatus.BOUNCED ||
      lead.status === LeadStatus.UNSUBSCRIBED ||
      lead.status === LeadStatus.SUPPRESSED
    ) {
      this.logger.warn(`Lead ${lead.email} is in global terminal state (${lead.status}). Dropping dispatch.`);
      await this.prisma.lead.update({ where: { id: lead.id }, data: { nextScheduledAt: null } }).catch(() => null);
      return;
    }

    // Check if lead has already replied to THIS campaign specifically
    const repliedInThisCampaign = await this.prisma.emailLog.findFirst({
      where: {
        campaignId,
        leadId: lead.id,
        inboundReplies: { some: {} },
      },
    });
    if (repliedInThisCampaign) {
      this.logger.log(`Lead ${lead.email} already replied to campaign ${campaignId}. Skipping.`);
      await this.prisma.lead.update({ where: { id: lead.id }, data: { nextScheduledAt: null } }).catch(() => null);
      return;
    }

    // 2. Pre-Send Gatekeeper check (exact + wildcard domain suppression)
    const gateCheck = await this.gatekeeper.validateRecipient(lead.email, lead.id);
    if (!gateCheck.allowed) {
      await this.prisma.lead.update({ where: { id: lead.id }, data: { nextScheduledAt: null } }).catch(() => null);
      return;
    }

    // 3. Obtain best available mailbox for this campaign via LRU rotation
    //    Re-check at execution time — another job may have consumed capacity since scheduling
    const mailbox = await this.mailboxesService.getAvailableMailboxForCampaign(campaignId);
    if (!mailbox) {
      this.logger.warn(
        `No mailbox with remaining capacity for campaign ${campaignId}. Re-queuing in 10 minutes.`,
      );
      // Re-queue without consuming a job attempt — wait for capacity to refresh
      setTimeout(() => this.enqueueDispatch(data, 0).catch(() => null), 10 * 60 * 1000);
      return;
    }

    // 4. Fetch Variant, Campaign, and Step details
    const [variant, campaign, step] = await Promise.all([
      this.prisma.sequenceVariant.findUnique({
        where: { id: sequenceVariantId },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
      }),
      this.prisma.sequenceStep.findUnique({
        where: { id: sequenceStepId },
      }),
    ]);

    if (!variant || !campaign) return;

    // Generate unique RFC 2822 Message-ID
    const uniqueHash = crypto.randomBytes(16).toString('hex');
    const domainHost = mailbox.email.split('@')[1] || 'outreach.internal';
    const messageId = `${Date.now()}.${uniqueHash}@${domainHost}`;

    // 5. Create initial EmailLog record with phase snapshot
    const emailLog = await this.prisma.emailLog.create({
      data: {
        messageId,
        campaignId,
        sequenceStepId,
        sequenceVariantId,
        phaseOrderSnapshot: stepOrder,
        phaseTitleSnapshot: step?.title || `Phase ${stepOrder}`,
        mailboxId: mailbox.id,
        leadId: lead.id,
        status: EmailDispatchStatus.PENDING,
      },
    });

    // 6. Personalize Subject and Body per recipient at send time (keeping variant template unchanged)
    const variables = this.spintaxService.buildVariableContext(lead, mailbox, campaign);
    const personalizedSubject = this.spintaxService.render(variant.subject, variables);
    const personalizedBody = this.spintaxService.render(variant.body, variables);

    // 7. Format body to HTML paragraphs if it's plain text with newlines, then inject open pixel & click proxy
    const hasHtmlBlocks = /<\/?(p|div|br|h[1-6]|table|ul|ol|li|blockquote|section)[^>]*>/i.test(personalizedBody);
    const formattedHtmlBody = hasHtmlBlocks
      ? personalizedBody
      : personalizedBody
          .replace(/\r\n/g, '\n')
          .split(/\n\s*\n/)
          .map((para) => `<p style="margin: 0 0 1em 0; line-height: 1.6;">${para.replace(/\n/g, '<br />')}</p>`)
          .join('\n');

    const unsubscribeUrl = `http://localhost:${this.configService.get('PORT', 3000)}/api/suppression/unsubscribe?token=${this.unsubscribeService.generateUnsubscribeToken(lead.email, campaignId)}`;
    const finalHtml = this.trackingService.injectTracking(
      formattedHtmlBody,
      emailLog.id,
      campaign.trackOpens,
      campaign.trackClicks,
    );

    // 8. Check for parent thread for follow-up steps (In-Reply-To / References)
    let inReplyTo: string | undefined;
    let references: string | undefined;
    if (stepOrder > 1) {
      const parentLog = await this.prisma.emailLog.findFirst({
        where: {
          campaignId,
          leadId: lead.id,
          status: EmailDispatchStatus.SENT,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (parentLog?.messageId) {
        inReplyTo = parentLog.messageId;
        references = parentLog.messageId;
      }
    }

    // 9. Decrypt mailbox credentials and dispatch with personalized content and formatted sender name
    const senderDisplayName =
      (mailbox.senderName && mailbox.senderName.trim()) ||
      (mailbox.displayName && mailbox.displayName.trim()) ||
      '';
    const fromAddress = senderDisplayName
      ? `"${senderDisplayName.replace(/"/g, '')}" <${mailbox.email.trim()}>`
      : mailbox.email.trim();

    try {
      const decryptedConfig = await this.mailboxesService.getDecryptedConfig(mailbox.id);
      const dispatchResult = await this.adapters.dispatch(mailbox.type, decryptedConfig, {
        to: lead.email,
        from: fromAddress,
        subject: personalizedSubject,
        html: finalHtml,
        text: personalizedBody.replace(/<[^>]*>/g, ''),
        messageId,
        inReplyTo,
        references,
        unsubscribeUrl,
      });

      if (!dispatchResult || !dispatchResult.success) {
        throw new Error(dispatchResult?.error || 'Provider rejected email dispatch');
      }

      // Update EmailLog
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: EmailDispatchStatus.SENT,
          sentAt: new Date(),
        },
      });

      // Increment mailbox daily & hourly counts
      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          sentCountToday: { increment: 1 },
          sentThisHour: { increment: 1 },
          lastSentAt: new Date(),
        },
      });

      // Compute next step for this campaign from the email logs (per-campaign progress)
      const nextStep = await this.prisma.sequenceStep.findFirst({
        where: {
          sequence: { campaignId },
          stepOrder: stepOrder + 1,
          isArchived: false,
        },
      });

      if (nextStep) {
        // Schedule next step delivery
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + nextStep.delayDays);
        nextDate.setHours(nextDate.getHours() + nextStep.delayHours);

        // Update CampaignRecipient with next phase schedule
        await this.prisma.campaignRecipient.updateMany({
          where: { campaignId, leadId: lead.id },
          data: {
            currentPhaseOrder: stepOrder + 1,
            phaseDeliveryStatus: 'PENDING',
            nextPhaseScheduledAt: nextDate,
            lastPhaseSentAt: new Date(),
          },
        });

        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.IN_PROGRESS,
            nextScheduledAt: nextDate,
          },
        });
      } else {
        // All steps for this campaign sent — mark phase complete
        await this.prisma.campaignRecipient.updateMany({
          where: { campaignId, leadId: lead.id },
          data: {
            currentPhaseOrder: stepOrder,
            phaseDeliveryStatus: 'COMPLETED',
            nextPhaseScheduledAt: null,
            lastPhaseSentAt: new Date(),
          },
        });

        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.IN_PROGRESS,
            nextScheduledAt: null,
          },
        });
      }

      this.logger.log(`Successfully dispatched step ${stepOrder} to ${lead.email} via ${mailbox.email}`);
    } catch (err: any) {
      this.logger.error(`Dispatch failed for lead ${lead.email}: ${err.message}`);
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: EmailDispatchStatus.FAILED,
          bounceReason: err.message,
        },
      });
      await this.prisma.campaignRecipient.updateMany({
        where: { campaignId, leadId: lead.id },
        data: {
          phaseDeliveryStatus: 'FAILED',
          nextPhaseScheduledAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minute backoff
        },
      }).catch(() => null);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          nextScheduledAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minute backoff
        },
      }).catch(() => null);
      throw err; // Trigger BullMQ retry backoff
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

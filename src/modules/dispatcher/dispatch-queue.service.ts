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
  ) {}

  onModuleInit() {
    const connection = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
    };

    this.queue = new Queue('email-dispatch-queue', { connection });
    this.queue.on('error', (err) => {
      this.logger.warn(`Redis queue connection warning: ${err.message}`);
    });

    this.worker = new Worker(
      'email-dispatch-queue',
      async (job: Job<DispatchJobData>) => {
        await this.processDispatchJob(job.data);
      },
      {
        connection,
        concurrency: 3, // Concurrency control per worker instance
      },
    );
    this.worker.on('error', (err) => {
      this.logger.warn(`Redis worker connection warning: ${err.message}`);
    });
  }

  /**
   * Schedules an outbound email job with calculated jitter delay
   */
  async enqueueDispatch(data: DispatchJobData, delayMs = 0) {
    await this.queue.add('send-email', data, {
      delay: delayMs,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
  }

  private async processDispatchJob(data: DispatchJobData) {
    const { campaignId, leadId, sequenceStepId, sequenceVariantId, stepOrder } = data;

    // 1. Fetch Lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) return;

    // Check if lead has already replied, bounced, or unsubscribed
    if (
      lead.status === LeadStatus.REPLIED ||
      lead.status === LeadStatus.BOUNCED ||
      lead.status === LeadStatus.UNSUBSCRIBED ||
      lead.status === LeadStatus.SUPPRESSED
    ) {
      return;
    }

    // 2. Pre-Send Gatekeeper check (exact + wildcard domain suppression)
    const gateCheck = await this.gatekeeper.validateRecipient(lead.email, lead.id);
    if (!gateCheck.allowed) {
      return;
    }

    // 3. Obtain assigned mailbox via least-recently-used pool rotation
    const mailbox = await this.mailboxesService.getAvailableMailboxForCampaign(campaignId);
    if (!mailbox) {
      this.logger.warn(`No healthy mailbox available for campaign ${campaignId}. Re-queuing in 10 minutes...`);
      await this.enqueueDispatch(data, 10 * 60 * 1000);
      return;
    }

    // 4. Fetch Variant and Campaign details
    const [variant, campaign] = await Promise.all([
      this.prisma.sequenceVariant.findUnique({
        where: { id: sequenceVariantId },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
      }),
    ]);

    if (!variant || !campaign) return;

    // Generate unique RFC 2822 Message-ID
    const uniqueHash = crypto.randomBytes(16).toString('hex');
    const domainHost = mailbox.email.split('@')[1] || 'outreach.internal';
    const messageId = `${Date.now()}.${uniqueHash}@${domainHost}`;

    // 5. Create initial EmailLog record
    const emailLog = await this.prisma.emailLog.create({
      data: {
        messageId,
        campaignId,
        sequenceStepId,
        sequenceVariantId,
        mailboxId: mailbox.id,
        leadId: lead.id,
        status: EmailDispatchStatus.PENDING,
      },
    });

    // 6. Inject open pixel & click proxy
    const unsubscribeUrl = `http://localhost:${this.configService.get('PORT', 3000)}/api/suppression/unsubscribe?token=${this.unsubscribeService.generateUnsubscribeToken(lead.email, campaignId)}`;
    const finalHtml = this.trackingService.injectTracking(
      variant.body,
      emailLog.id,
      campaign.trackOpens,
      campaign.trackClicks,
    );

    // 7. Check for parent thread for follow-up steps (In-Reply-To / References)
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

    // 8. Decrypt mailbox credentials and dispatch
    try {
      const decryptedConfig = await this.mailboxesService.getDecryptedConfig(mailbox.id);
      await this.adapters.dispatch(mailbox.type, decryptedConfig, {
        to: lead.email,
        from: mailbox.email,
        subject: variant.subject,
        html: finalHtml,
        messageId,
        inReplyTo,
        references,
        unsubscribeUrl,
      });

      // Update EmailLog
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: EmailDispatchStatus.SENT,
          sentAt: new Date(),
        },
      });

      // Increment mailbox daily count
      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          sentCountToday: { increment: 1 },
          lastSentAt: new Date(),
        },
      });

      // Compute next step schedule for lead
      const nextStep = await this.prisma.sequenceStep.findFirst({
        where: {
          sequence: { campaignId },
          stepOrder: stepOrder + 1,
        },
      });

      if (nextStep) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + nextStep.delayDays);
        nextDate.setHours(nextDate.getHours() + nextStep.delayHours);

        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.IN_PROGRESS,
            currentStepOrder: stepOrder + 1,
            nextScheduledAt: nextDate,
          },
        });
      } else {
        // All sequence steps sent
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.COMPLETED,
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
      throw err; // Trigger BullMQ retry backoff
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

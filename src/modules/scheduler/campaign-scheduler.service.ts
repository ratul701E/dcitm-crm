import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DispatchQueueService } from '../dispatcher/dispatch-queue.service';
import { SequencesService } from '../sequences/sequences.service';
import { SpintaxService } from '../spintax/spintax.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { CampaignStatus, LeadStatus } from '@prisma/client';

import { EmailDelayService } from '../campaigns/email-delay.service';

// Absolute terminal statuses — these block a lead from ALL future campaigns
const TERMINAL_STATUSES = [
  LeadStatus.BOUNCED,
  LeadStatus.UNSUBSCRIBED,
  LeadStatus.SUPPRESSED,
];

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchQueue: DispatchQueueService,
    private readonly sequencesService: SequencesService,
    private readonly spintaxService: SpintaxService,
    private readonly mailboxesService: MailboxesService,
    private readonly emailDelayService: EmailDelayService,
  ) {}

  /**
   * Evaluates due campaigns every 30 seconds or upon manual trigger.
   *
   * Key design decisions:
   * - Lead eligibility is per-campaign, derived from EmailLog — not from lead.status.
   *   A lead that completed Campaign A is still eligible for Campaign B.
   * - Absolute terminal statuses (BOUNCED, UNSUBSCRIBED, SUPPRESSED) block a lead globally.
   * - Mailbox hourly limits are enforced using real-time EmailLog counts (shared globally).
   * - Pacing delay uses sentAt (not createdAt) so only truly sent emails count.
   */
  @Cron('*/30 * * * * *')
  async evaluateSchedules(specificCampaignId?: string, forceImmediate = false) {
    if (this.isRunning && !forceImmediate) return;
    this.isRunning = true;

    try {
      const activeCampaigns = await this.prisma.campaign.findMany({
        where: {
          status: CampaignStatus.ACTIVE,
          ...(specificCampaignId ? { id: specificCampaignId } : {}),
        },
        include: {
          campaignLeadLists: true,
          campaignMailboxes: { include: { mailbox: true } },
          sequences: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                include: { variants: true },
              },
            },
          },
        },
      });

      const now = new Date();

      for (const campaign of activeCampaigns) {
        try {
          await this.processCampaign(campaign, now, forceImmediate);
        } catch (err: any) {
          this.logger.error(`Error processing campaign "${campaign.title}": ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Scheduler evaluation error: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processCampaign(campaign: any, now: Date, forceImmediate: boolean) {
    // 1. Sending window check
    if (!forceImmediate && !this.isWithinSendingWindow(campaign, now)) {
      return;
    }

    const leadListIds = campaign.campaignLeadLists.map((l: any) => l.leadListId);
    if (leadListIds.length === 0) {
      this.logger.debug(`Campaign "${campaign.title}" has no lead lists. Skipping.`);
      return;
    }

    // 2. Verify sequence is configured
    const sequence = campaign.sequences[0];
    if (!sequence || sequence.steps.length === 0) {
      this.logger.warn(`Campaign "${campaign.title}" has no sequence steps configured. Skipping.`);
      return;
    }

    // 3. Check campaign-level hourly limit and mailbox availability FIRST (fast-fail before querying leads)
    const startOfHour = new Date(now);
    startOfHour.setMinutes(0, 0, 0);
    const campaignHourlySent = await this.prisma.emailLog.count({
      where: {
        campaignId: campaign.id,
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gte: startOfHour },
      },
    });
    if (campaignHourlySent >= (campaign.hourlyLimit || 10) && !forceImmediate) {
      this.logger.log(
        `Campaign "${campaign.title}": campaign hourly limit reached (${campaignHourlySent}/${campaign.hourlyLimit}). Deferring.`,
      );
      return;
    }

    const availableMailbox = await this.mailboxesService.getAvailableMailboxForCampaign(campaign.id);
    if (!availableMailbox && !forceImmediate) {
      this.logger.log(`Campaign "${campaign.title}": all mailboxes at hourly limit. Deferring.`);
      return;
    }

    // 4. Pacing check — respect calculated nextAllowedSendAt, or fallback to sentAt pacing
    if (!forceImmediate) {
      if (campaign.nextAllowedSendAt) {
        const nextAllowed = new Date(campaign.nextAllowedSendAt).getTime();
        if (now.getTime() < nextAllowed) {
          const remainingSecs = Math.round((nextAllowed - now.getTime()) / 1000);
          this.logger.debug(
            `Campaign "${campaign.title}" delay active: ${remainingSecs}s remaining until next allowed send.`,
          );
          return;
        }
      } else {
        const pacingDelaySeconds = (campaign as any).minimumDelaySeconds ?? (campaign as any).minDelaySeconds ?? 45;
        const lastSentLog = await this.prisma.emailLog.findFirst({
          where: {
            campaignId: campaign.id,
            status: { in: ['SENT', 'DELIVERED'] },
          },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        });

        if (lastSentLog?.sentAt) {
          const elapsedSeconds = (now.getTime() - new Date(lastSentLog.sentAt).getTime()) / 1000;
          if (elapsedSeconds < pacingDelaySeconds) {
            this.logger.debug(
              `Campaign "${campaign.title}" pacing: ${Math.round(elapsedSeconds)}s / ${pacingDelaySeconds}s`,
            );
            return;
          }
        }
      }
    }

    // 5. Find candidate leads — filter out ONLY absolute terminal statuses globally.
    //    COMPLETED, REPLIED, IN_PROGRESS, NEW are all valid for per-campaign evaluation.
    //    Exclude leads who have already sent the final step of this campaign or replied to it.
    const lastStep = sequence.steps[sequence.steps.length - 1];
    const candidateLeads = await this.prisma.lead.findMany({
      where: {
        leadListId: { in: leadListIds },
        deletedAt: null,
        status: { notIn: TERMINAL_STATUSES },
        OR: [
          { nextScheduledAt: null },
          { nextScheduledAt: { lte: now } },
        ],
        NOT: [
          ...(lastStep ? [{
            emailLogs: {
              some: {
                campaignId: campaign.id,
                sequenceStepId: lastStep.id,
                status: { in: ['SENT', 'DELIVERED'] as any },
              },
            },
          }] : []),
          {
            emailLogs: {
              some: {
                campaignId: campaign.id,
                inboundReplies: { some: {} },
              },
            },
          },
        ],
      },
      orderBy: [
        { createdAt: 'asc' },
      ],
      take: 100,
    });

    if (candidateLeads.length === 0) {
      this.logger.debug(`Campaign "${campaign.title}": no eligible leads found.`);
      return;
    }

    // 6. For each candidate, derive per-campaign step progress from EmailLog
    for (const lead of candidateLeads) {
      // Get all email logs for this lead in this campaign, ordered by step
      const campaignLogs = await this.prisma.emailLog.findMany({
        where: { campaignId: campaign.id, leadId: lead.id },
        include: {
          sequenceStep: { select: { stepOrder: true } },
          inboundReplies: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      // If lead already replied to this campaign, skip
      if (campaignLogs.some((l) => l.inboundReplies && l.inboundReplies.length > 0)) {
        continue;
      }

      // Determine which step to send next for this campaign
      const nextStepOrder = this.deriveNextStepOrder(campaignLogs, sequence.steps);

      // null means all steps completed for this campaign — skip
      if (nextStepOrder === null) {
        if (lead.nextScheduledAt) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { nextScheduledAt: null },
          }).catch(() => null);
        }
        continue;
      }

      const step = sequence.steps.find((s: any) => s.stepOrder === nextStepOrder);
      if (!step) continue;

      // Check if this step is already pending/in-flight for this lead
      const stepLogsForThisStep = campaignLogs.filter(
        (l) => l.sequenceStep?.stepOrder === nextStepOrder,
      );
      const hasPending = stepLogsForThisStep.some((l) => l.status === 'PENDING');
      if (hasPending) continue;

      // Check failure backoff
      const failedLogs = stepLogsForThisStep.filter((l) => l.status === 'FAILED');
      if (failedLogs.length >= 3) {
        this.logger.warn(
          `Lead ${lead.email} hit max retries for step ${nextStepOrder} in campaign "${campaign.title}". Skipping.`,
        );
        continue;
      }
      if (failedLogs.length > 0) {
        const lastFailed = failedLogs[0];
        const backoffMs = 5 * 60 * 1000;
        if (now.getTime() - new Date(lastFailed.createdAt).getTime() < backoffMs) {
          continue;
        }
      }

      // Check if we still have a mailbox available (capacity may have been consumed by a prior lead in this loop)
      const mailbox = await this.mailboxesService.getAvailableMailboxForCampaign(campaign.id);
      if (!mailbox) {
        this.logger.log(`Campaign "${campaign.title}": mailbox pool exhausted mid-loop. Stopping.`);
        break;
      }

      // Select A/B variant
      const variant = this.sequencesService.selectWeightedVariant(step.variants);
      if (!variant) continue;

      // Calculate dynamic delay for the transition to the NEXT email
      const delayResult = this.emailDelayService.generateDelay({
        mode: campaign.delayMode,
        minimumDelaySeconds: campaign.minimumDelaySeconds ?? campaign.minDelaySeconds ?? 10,
        maximumDelaySeconds: campaign.maximumDelaySeconds,
        seed: campaign.randomSeed || campaign.id,
        sequenceIndex: campaign.delaySequenceIndex ?? 0,
      });

      const nextAllowedSendAt = new Date(now.getTime() + delayResult.delaySeconds * 1000);

      // Persist next allowed send timestamp and advance PRNG sequence index atomically
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          nextAllowedSendAt,
          delaySequenceIndex: { increment: 1 },
        },
      });

      // Item 16: Telemetry logging for transition delay
      this.logger.log(
        `[EmailDelay] Transition scheduled for campaign "${campaign.title}": ` +
        JSON.stringify({
          campaignId: campaign.id,
          recipientId: lead.id,
          recipientEmail: lead.email,
          delayMode: delayResult.mode,
          minimumDelay: delayResult.minimumDelaySeconds,
          maximumDelay: delayResult.maximumDelaySeconds,
          effectiveMaximum: delayResult.effectiveMaximum,
          generatedDelay: delayResult.delaySeconds,
          sequenceIndex: delayResult.sequenceIndex,
          nextAllowedSendAt: nextAllowedSendAt.toISOString(),
          timestamp: new Date().toISOString(),
        }),
      );

      // Temporary lock: set nextScheduledAt 60s forward to prevent duplicate pickup
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { nextScheduledAt: new Date(now.getTime() + 60 * 1000) },
      });

      // Enqueue for immediate dispatch
      await this.dispatchQueue.enqueueDispatch(
        {
          campaignId: campaign.id,
          leadId: lead.id,
          sequenceStepId: step.id,
          sequenceVariantId: variant.id,
          stepOrder: step.stepOrder,
        },
        0,
      );

      this.logger.log(
        `[Scheduler] Dispatching step ${step.stepOrder} → ${lead.email} via ${mailbox.email} in campaign "${campaign.title}" (next delay: ${delayResult.delaySeconds}s)`,
      );

      // Send one email per scheduler tick to respect the calculated pacing delay
      break;
    }
  }

  /**
   * Derives the next step order to send for a lead in a specific campaign,
   * based entirely on that campaign's EmailLog records.
   *
   * Returns null if all steps have been sent successfully.
   */
  private deriveNextStepOrder(
    campaignLogs: Array<{ status: string; sequenceStep: { stepOrder: number } | null }>,
    sequenceSteps: Array<{ stepOrder: number }>,
  ): number | null {
    if (sequenceSteps.length === 0) return null;

    // Find the highest stepOrder that has a SENT or DELIVERED log
    const sentStepOrders = campaignLogs
      .filter((l) => l.status === 'SENT' || l.status === 'DELIVERED')
      .map((l) => l.sequenceStep?.stepOrder ?? 0)
      .filter((o) => o > 0);

    if (sentStepOrders.length === 0) {
      // No emails sent yet for this campaign — start at step 1
      return sequenceSteps[0].stepOrder;
    }

    const maxSentOrder = Math.max(...sentStepOrders);
    const nextOrder = maxSentOrder + 1;

    // Check if next step exists
    const nextExists = sequenceSteps.some((s) => s.stepOrder === nextOrder);
    if (!nextExists) {
      // All steps completed for this campaign
      return null;
    }

    return nextOrder;
  }

  /**
   * Validates target timezone, daily time window, and active weekdays
   */
  private isWithinSendingWindow(campaign: any, now: Date): boolean {
    try {
      if (
        (campaign.dailyWindowStart === '00:00' && campaign.dailyWindowEnd === '23:59') ||
        (campaign.dailyWindowStart === '00:00' && campaign.dailyWindowEnd === '00:00')
      ) {
        return true;
      }

      const tz = campaign.targetTimezone || 'UTC';
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      });
      const dayMap: Record<string, number> = {
        Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
      };
      const dayName = dayFormatter.format(now);
      const currentDay = dayMap[dayName] || 1;

      if (!campaign.activeDays.includes(currentDay)) {
        return false;
      }

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const timeParts = timeFormatter.formatToParts(now);
      const hour = timeParts.find((p) => p.type === 'hour')?.value || '00';
      const minute = timeParts.find((p) => p.type === 'minute')?.value || '00';
      const currentTimeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

      return (
        currentTimeStr >= campaign.dailyWindowStart &&
        currentTimeStr <= campaign.dailyWindowEnd
      );
    } catch {
      return true;
    }
  }
}

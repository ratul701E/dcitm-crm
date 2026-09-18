import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DispatchQueueService } from '../dispatcher/dispatch-queue.service';
import { SequencesService } from '../sequences/sequences.service';
import { SpintaxService } from '../spintax/spintax.service';
import { CampaignStatus, LeadStatus } from '@prisma/client';

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchQueue: DispatchQueueService,
    private readonly sequencesService: SequencesService,
    private readonly spintaxService: SpintaxService,
  ) {}

  /**
   * Evaluates due campaigns and prospects every 2 minutes
   */
  @Cron('*/2 * * * *')
  async evaluateSchedules() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Fetch all ACTIVE campaigns
      const activeCampaigns = await this.prisma.campaign.findMany({
        where: { status: CampaignStatus.ACTIVE },
        include: {
          campaignLeadLists: true,
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
        // 2. Validate current time falls into target timezone working window
        if (!this.isWithinSendingWindow(campaign, now)) {
          continue;
        }

        const leadListIds = campaign.campaignLeadLists.map((l) => l.leadListId);
        if (leadListIds.length === 0) continue;

        // 3. Find leads whose nextScheduledAt is due
        const dueLeads = await this.prisma.lead.findMany({
          where: {
            leadListId: { in: leadListIds },
            status: { in: [LeadStatus.NEW, LeadStatus.IN_PROGRESS] },
            nextScheduledAt: { lte: now },
          },
          take: 25, // Batch limit per cycle
        });

        if (dueLeads.length === 0) continue;

        const sequence = campaign.sequences[0];
        if (!sequence || sequence.steps.length === 0) continue;

        for (let i = 0; i < dueLeads.length; i++) {
          const lead = dueLeads[i];
          const step = sequence.steps.find((s) => s.stepOrder === lead.currentStepOrder);
          if (!step) continue;

          // Pick A/B variant via weighted random selector
          const variant = this.sequencesService.selectWeightedVariant(step.variants);
          if (!variant) continue;

          // Render Spintax & interpolate custom variables
          const mergedVariables = {
            firstName: lead.firstName || 'there',
            lastName: lead.lastName || '',
            companyName: lead.company || 'your company',
            company: lead.company || 'your company',
            jobTitle: lead.jobTitle || '',
            website: lead.website || '',
            linkedIn: lead.linkedIn || '',
            city: lead.city || '',
            country: lead.country || '',
            customVariables: (lead.customVariables as object) || {},
          };

          const renderedSubject = this.spintaxService.render(variant.subject, mergedVariables);
          const renderedBody = this.spintaxService.render(variant.body, mergedVariables);

          // Calculate human-like jitter delay: 60s to 180s per lead send
          const jitterDelayMs = (i * 75 + Math.floor(Math.random() * 45)) * 1000;

          // Enqueue dispatch
          await this.dispatchQueue.enqueueDispatch(
            {
              campaignId: campaign.id,
              leadId: lead.id,
              sequenceStepId: step.id,
              sequenceVariantId: variant.id,
              stepOrder: step.stepOrder,
            },
            jitterDelayMs,
          );

          // Push schedule forward immediately to prevent duplicate pick in next scheduler cycle
          const temporaryLockDate = new Date(Date.now() + 15 * 60 * 1000);
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { nextScheduledAt: temporaryLockDate },
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Scheduler evaluation error: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Validates target timezone, daily time window (e.g. 09:00 - 17:00), and active weekdays
   */
  private isWithinSendingWindow(campaign: any, now: Date): boolean {
    try {
      const tz = campaign.targetTimezone || 'UTC';
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'narrow',
      });

      // Get target timezone day of week (1 = Mon ... 7 = Sun)
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      });
      const dayMap: Record<string, number> = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };
      const dayName = dayFormatter.format(now);
      const currentDay = dayMap[dayName] || 1;

      if (!campaign.activeDays.includes(currentDay)) {
        return false;
      }

      // Check current HH:mm against start/end window
      const timeParts = formatter.formatToParts(now);
      const hour = timeParts.find((p) => p.type === 'hour')?.value || '00';
      const minute = timeParts.find((p) => p.type === 'minute')?.value || '00';
      const currentTimeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

      return (
        currentTimeStr >= campaign.dailyWindowStart &&
        currentTimeStr <= campaign.dailyWindowEnd
      );
    } catch {
      return true; // Fallback to allow dispatch if timezone format fails
    }
  }
}

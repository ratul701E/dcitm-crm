import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProviderAdaptersService } from '../dispatcher/provider-adapters.service';
import { CampaignSchedulerService } from '../scheduler/campaign-scheduler.service';
import { SpintaxService } from '../spintax/spintax.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  SendTestEmailDto,
  PreviewDelaysDto,
} from './dto/campaign.dto';
import { CampaignStatus, DelayMode, LeadStatus, MailboxState } from '@prisma/client';
import { EmailDelayService } from './email-delay.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailboxesService: MailboxesService,
    private readonly providerAdaptersService: ProviderAdaptersService,
    private readonly campaignScheduler: CampaignSchedulerService,
    private readonly spintaxService: SpintaxService,
    private readonly emailDelayService: EmailDelayService,
  ) {}

  /**
   * Captures an immutable snapshot of recipient leads from assigned lead lists.
   */
  private async snapshotCampaignRecipients(
    tx: any,
    campaignId: string,
    leadListIds: string[],
    excludedLeadListIds: string[] = [],
  ) {
    if (!leadListIds || leadListIds.length === 0) return 0;
    const validListIds = leadListIds.filter((lid) => !excludedLeadListIds.includes(lid));
    if (validListIds.length === 0) return 0;

    const eligibleLeads = await tx.lead.findMany({
      where: {
        leadListId: { in: validListIds },
        deletedAt: null,
        status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
      },
    });

    const seenEmails = new Set<string>();
    const snapshotData: any[] = [];
    for (const lead of eligibleLeads) {
      const normalized = lead.email.trim().toLowerCase();
      if (!seenEmails.has(normalized)) {
        seenEmails.add(normalized);
        snapshotData.push({
          campaignId,
          leadId: lead.id,
          email: lead.email,
          firstName: lead.firstName,
          lastName: lead.lastName,
          company: lead.company,
        });
      }
    }

    if (snapshotData.length > 0) {
      await tx.campaignRecipient.createMany({
        data: snapshotData,
        skipDuplicates: true,
      });
    }

    return snapshotData.length;
  }

  async create(userId: string, dto: CreateCampaignDto) {
    const minDelay = dto.minimumDelaySeconds ?? dto.minDelaySeconds ?? 10;
    const seed = dto.randomSeed || this.emailDelayService.generateSecureSeed();

    const created = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          title: dto.title,
          status: dto.status || CampaignStatus.DRAFT,
          targetTimezone: dto.targetTimezone || 'UTC',
          dailyWindowStart: dto.dailyWindowStart || '09:00',
          dailyWindowEnd: dto.dailyWindowEnd || '17:00',
          activeDays: dto.activeDays || [1, 2, 3, 4, 5],
          maxNewLeadsPerDay: dto.maxNewLeadsPerDay || 50,
          hourlyLimit: dto.hourlyLimit || 10,
          delayMode: dto.delayMode || DelayMode.WEIGHTED_RANDOM,
          minimumDelaySeconds: minDelay,
          maximumDelaySeconds: dto.maximumDelaySeconds !== undefined ? dto.maximumDelaySeconds : null,
          randomSeed: seed,
          delaySequenceIndex: 0,
          minDelaySeconds: minDelay,
          trackOpens: dto.trackOpens !== undefined ? dto.trackOpens : true,
          trackClicks: dto.trackClicks !== undefined ? dto.trackClicks : true,
          campaignType: dto.campaignType || 'outreach',
          tags: dto.tags || [],
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          replyToEmail: dto.replyToEmail || null,
          excludedLeadListIds: dto.excludedLeadListIds || [],
          retryOnSoftBounce: dto.retryOnSoftBounce !== undefined ? dto.retryOnSoftBounce : true,
          unsubscribeLinkEnabled: dto.unsubscribeLinkEnabled !== undefined ? dto.unsubscribeLinkEnabled : true,
          createdById: userId,
        },
      });

      // Attach mailboxes if provided (only existing IDs)
      if (dto.mailboxIds && dto.mailboxIds.length > 0) {
        const validMailboxes = await tx.mailbox.findMany({
          where: { id: { in: dto.mailboxIds } },
          select: { id: true },
        });
        if (validMailboxes.length > 0) {
          await tx.campaignMailbox.createMany({
            data: validMailboxes.map((m) => ({
              campaignId: campaign.id,
              mailboxId: m.id,
            })),
          });
        }
      }

      // Attach lead lists if provided (only existing IDs)
      if (dto.leadListIds && dto.leadListIds.length > 0) {
        const validLeadLists = await tx.leadList.findMany({
          where: { id: { in: dto.leadListIds } },
          select: { id: true },
        });
        if (validLeadLists.length > 0) {
          await tx.campaignLeadList.createMany({
            data: validLeadLists.map((l) => ({
              campaignId: campaign.id,
              leadListId: l.id,
            })),
          });

          // Snapshot recipients at creation time
          await this.snapshotCampaignRecipients(
            tx,
            campaign.id,
            validLeadLists.map((l) => l.id),
            dto.excludedLeadListIds || [],
          );
        }
      }

      // Automatically create the initial default sequence container
      const sequence = await tx.sequence.create({
        data: {
          campaignId: campaign.id,
          title: `${dto.title} Sequence`,
        },
      });

      // If email content was provided in the wizard, persist it as step 1 immediately
      if (dto.subject || dto.emailBody) {
        const step = await tx.sequenceStep.create({
          data: {
            sequenceId: sequence.id,
            stepOrder: 1,
            delayDays: 0,
            delayHours: 0,
          },
        });
        await tx.sequenceVariant.create({
          data: {
            sequenceStepId: step.id,
            variantKey: 'A',
            subject: dto.subject ?? '{{firstName}}, quick question',
            body: dto.emailBody ?? '<p>Hi {{firstName}},</p><p>Wanted to reach out about {{company}}.</p><p>Best regards,<br/>{{senderName}}</p>',
            weight: 100,
          },
        });
      }

      return campaign;
    }, { timeout: 30000 });

    // Prime lead nextScheduledAt outside the transaction to avoid timeout on large lists
    if (dto.status === CampaignStatus.ACTIVE) {
      await this.prisma.lead.updateMany({
        where: {
          campaignRecipients: { some: { campaignId: created.id } },
          status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
        },
        data: {
          nextScheduledAt: new Date(),
        },
      });
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'CAMPAIGN_CREATE',
      targetEntity: 'Campaign',
      targetId: created.id,
      metadata: { title: created.title },
      status: 'success',
    });

    if (dto.status === CampaignStatus.ACTIVE) {
      setTimeout(() => {
        this.campaignScheduler.evaluateSchedules(created.id, true).catch(console.error);
      }, 500);
    }

    return this.findOne(created.id);
  }

  async findAll() {
    const campaigns = await this.prisma.campaign.findMany({
      include: {
        campaignMailboxes: {
          include: {
            mailbox: {
              select: {
                id: true,
                email: true,
                type: true,
                state: true,
                sentCountToday: true,
                hourlyLimit: true,
                dailySendingLimit: true,
              },
            },
          },
        },
        campaignLeadLists: {
          include: {
            leadList: {
              select: {
                id: true,
                name: true,
                _count: { select: { leads: true } },
              },
            },
          },
        },
        sequences: {
          include: {
            steps: {
              orderBy: { stepOrder: 'asc' },
              include: { variants: true },
            },
          },
        },
        _count: {
          select: {
            emailLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      campaigns.map(async (c) => {
        const [stats, throttleStatus] = await Promise.all([
          this.getStats(c.id).catch(() => null),
          this.getCampaignThrottleStatus(c.id).catch(() => ({ isThrottled: false })),
        ]);
        return {
          ...c,
          stats,
          throttleStatus,
        };
      }),
    );
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        campaignMailboxes: {
          include: {
            mailbox: {
              select: {
                id: true,
                email: true,
                senderName: true,
                displayName: true,
                replyToEmail: true,
                type: true,
                state: true,
                sentCountToday: true,
                dailySendingLimit: true,
              },
            },
          },
        },
        campaignLeadLists: {
          include: {
            leadList: {
              select: {
                id: true,
                name: true,
                leads: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    company: true,
                    jobTitle: true,
                    status: true,
                    verificationStatus: true,
                    nextScheduledAt: true,
                    currentStepOrder: true,
                  },
                },
                _count: { select: { leads: true } },
              },
            },
          },
        },
        recipients: {
          include: {
            lead: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                company: true,
                jobTitle: true,
                status: true,
                verificationStatus: true,
                nextScheduledAt: true,
                currentStepOrder: true,
              },
            },
          },
        },
        sequences: {
          include: {
            steps: {
              orderBy: { stepOrder: 'asc' },
              include: { variants: true },
            },
          },
        },
        emailLogs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            leadId: true,
            status: true,
            sentAt: true,
            openedAt: true,
            clickedAt: true,
            bounceReason: true,
            mailbox: {
              select: {
                id: true,
                email: true,
                senderName: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status === CampaignStatus.ACTIVE) {
      const finalized = await this.campaignScheduler.checkAndFinalizeCampaignStatus(campaign);
      if (finalized) {
        const fresh = await this.prisma.campaign.findUnique({
          where: { id },
          select: { status: true },
        });
        if (fresh) campaign.status = fresh.status;
      }
    }

    // Auto-backfill snapshot for legacy campaigns if recipients is empty
    if ((campaign as any).recipients?.length === 0 && campaign.campaignLeadLists?.length > 0) {
      const listIds = campaign.campaignLeadLists.map((cl: any) => cl.leadListId);
      await this.snapshotCampaignRecipients(
        this.prisma,
        campaign.id,
        listIds,
        campaign.excludedLeadListIds || [],
      );
      (campaign as any).recipients = await this.prisma.campaignRecipient.findMany({
        where: { campaignId: campaign.id },
        include: {
          lead: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
              jobTitle: true,
              status: true,
              verificationStatus: true,
              nextScheduledAt: true,
              currentStepOrder: true,
            },
          },
        },
      });
    }

    const [stats, throttleStatus] = await Promise.all([
      this.getStats(id).catch(() => null),
      this.getCampaignThrottleStatus(id).catch(() => ({ isThrottled: false })),
    ]);

    return {
      ...campaign,
      stats,
      throttleStatus,
    };
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const current = await this.findOne(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const minDelay = dto.minimumDelaySeconds !== undefined
        ? dto.minimumDelaySeconds
        : dto.minDelaySeconds;

      const updated = await tx.campaign.update({
        where: { id },
        data: {
          title: dto.title,
          status: dto.status,
          targetTimezone: dto.targetTimezone,
          dailyWindowStart: dto.dailyWindowStart,
          dailyWindowEnd: dto.dailyWindowEnd,
          activeDays: dto.activeDays,
          maxNewLeadsPerDay: dto.maxNewLeadsPerDay,
          hourlyLimit: dto.hourlyLimit,
          delayMode: dto.delayMode,
          minimumDelaySeconds: minDelay,
          maximumDelaySeconds: dto.maximumDelaySeconds,
          randomSeed: dto.randomSeed,
          minDelaySeconds: minDelay,
          trackOpens: dto.trackOpens,
          trackClicks: dto.trackClicks,
          campaignType: dto.campaignType,
          tags: dto.tags,
          scheduledFor: dto.scheduledFor !== undefined ? (dto.scheduledFor ? new Date(dto.scheduledFor) : null) : undefined,
          replyToEmail: dto.replyToEmail,
          excludedLeadListIds: dto.excludedLeadListIds,
          retryOnSoftBounce: dto.retryOnSoftBounce,
          unsubscribeLinkEnabled: dto.unsubscribeLinkEnabled,
        },
      });

      // Update mailbox pool associations if explicitly provided (only existing IDs)
      if (dto.mailboxIds) {
        await tx.campaignMailbox.deleteMany({ where: { campaignId: id } });
        if (dto.mailboxIds.length > 0) {
          const validMailboxes = await tx.mailbox.findMany({
            where: { id: { in: dto.mailboxIds } },
            select: { id: true },
          });
          if (validMailboxes.length > 0) {
            await tx.campaignMailbox.createMany({
              data: validMailboxes.map((m) => ({
                campaignId: id,
                mailboxId: m.id,
              })),
            });
          }
        }
      }

      // Update lead list associations if explicitly provided (only existing IDs)
      // NOTE: If the campaign is already completed, the recipients snapshot is permanently frozen.
      const isCompleted = ([
        CampaignStatus.COMPLETED,
        CampaignStatus.COMPLETED_WITH_ERRORS,
        CampaignStatus.FAILED,
      ] as string[]).includes(current.status);

      if (!isCompleted && dto.leadListIds) {
        await tx.campaignLeadList.deleteMany({ where: { campaignId: id } });
        if (dto.leadListIds.length > 0) {
          const validLeadLists = await tx.leadList.findMany({
            where: { id: { in: dto.leadListIds } },
            select: { id: true },
          });
          if (validLeadLists.length > 0) {
            await tx.campaignLeadList.createMany({
              data: validLeadLists.map((l) => ({
                campaignId: id,
                leadListId: l.id,
              })),
            });

            // Resynchronize snapshot if campaign is DRAFT or has sent 0 emails
            const logsCount = await tx.emailLog.count({ where: { campaignId: id } });
            if (logsCount === 0) {
              await tx.campaignRecipient.deleteMany({ where: { campaignId: id } });
              await this.snapshotCampaignRecipients(
                tx,
                id,
                validLeadLists.map((l) => l.id),
                dto.excludedLeadListIds || current.excludedLeadListIds || [],
              );
            }
          }
        }
      }

      // If campaign transitions to ACTIVE, prime initial nextScheduledAt for snapshotted leads
      if (dto.status === CampaignStatus.ACTIVE) {
        await tx.lead.updateMany({
          where: {
            campaignRecipients: { some: { campaignId: id } },
            status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
          },
          data: {
            nextScheduledAt: new Date(),
          },
        });
      }

      return updated;
    });

    if (dto.status === CampaignStatus.ACTIVE) {
      setTimeout(() => {
        this.campaignScheduler.evaluateSchedules(id, true).catch(console.error);
      }, 500);
    }

    await this.auditService.log({
      action: 'CAMPAIGN_UPDATE',
      targetEntity: 'Campaign',
      targetId: id,
      metadata: dto,
      status: 'success',
    });

    return updated;
  }

  async duplicate(id: string, userId: string) {
    const original = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        campaignMailboxes: true,
        campaignLeadLists: true,
        sequences: {
          include: {
            steps: {
              include: { variants: true },
            },
          },
        },
      },
    });

    if (!original) {
      throw new NotFoundException('Campaign not found');
    }

    const duplicated = await this.prisma.$transaction(async (tx) => {
      const duplicated = await tx.campaign.create({
        data: {
          title: `${original.title} (Copy)`,
          status: CampaignStatus.DRAFT,
          campaignType: original.campaignType,
          tags: original.tags,
          scheduledFor: null,
          replyToEmail: original.replyToEmail,
          excludedLeadListIds: original.excludedLeadListIds,
          retryOnSoftBounce: original.retryOnSoftBounce,
          unsubscribeLinkEnabled: original.unsubscribeLinkEnabled,
          targetTimezone: original.targetTimezone,
          dailyWindowStart: original.dailyWindowStart,
          dailyWindowEnd: original.dailyWindowEnd,
          activeDays: original.activeDays,
          maxNewLeadsPerDay: original.maxNewLeadsPerDay,
          trackOpens: original.trackOpens,
          trackClicks: original.trackClicks,
          createdById: userId,
        },
      });

      if (original.campaignMailboxes.length > 0) {
        await tx.campaignMailbox.createMany({
          data: original.campaignMailboxes.map((cm) => ({
            campaignId: duplicated.id,
            mailboxId: cm.mailboxId,
          })),
        });
      }

      if (original.campaignLeadLists.length > 0) {
        await tx.campaignLeadList.createMany({
          data: original.campaignLeadLists.map((cl) => ({
            campaignId: duplicated.id,
            leadListId: cl.leadListId,
          })),
        });

        // Snapshot current members of the lists for the duplicated campaign
        const listIds = original.campaignLeadLists.map((cl) => cl.leadListId);
        await this.snapshotCampaignRecipients(
          tx,
          duplicated.id,
          listIds,
          original.excludedLeadListIds || [],
        );
      }

      for (const seq of original.sequences) {
        const newSeq = await tx.sequence.create({
          data: {
            campaignId: duplicated.id,
            title: seq.title,
          },
        });

        for (const step of seq.steps) {
          const newStep = await tx.sequenceStep.create({
            data: {
              sequenceId: newSeq.id,
              stepOrder: step.stepOrder,
              delayDays: step.delayDays,
              delayHours: step.delayHours,
            },
          });

          if (step.variants.length > 0) {
            await tx.sequenceVariant.createMany({
              data: step.variants.map((v) => ({
                sequenceStepId: newStep.id,
                variantKey: v.variantKey,
                weight: v.weight,
                subject: v.subject,
                body: v.body,
              })),
            });
          }
        }
      }

      return duplicated;
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'CAMPAIGN_DUPLICATE',
      targetEntity: 'Campaign',
      targetId: duplicated.id,
      metadata: { originalCampaignId: id, title: duplicated.title },
      status: 'success',
    });

    return duplicated;
  }

  /**
   * Evaluates if a campaign's sending is currently paused due to hourly or daily mailbox/campaign limits
   */
  async getCampaignThrottleStatus(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        campaignMailboxes: {
          include: {
            mailbox: true,
          },
        },
      },
    });

    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
      return { isThrottled: false };
    }

    const pool = campaign.campaignMailboxes
      .map((cm) => cm.mailbox)
      .filter((m) => m.state === MailboxState.ACTIVE || m.state === MailboxState.WARMING);

    if (pool.length === 0) {
      return {
        isThrottled: true,
        reason: 'NO_ACTIVE_MAILBOXES' as const,
        message: 'No active mailboxes configured or available for this campaign.',
      };
    }

    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const resumesInMinutes = Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 60000));

    // Check campaign-level hourly limit
    const startOfHour = new Date(now);
    startOfHour.setMinutes(0, 0, 0);
    const campaignHourlySent = await this.prisma.emailLog.count({
      where: {
        campaignId: campaign.id,
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gte: startOfHour },
      },
    });

    if (campaignHourlySent >= (campaign.hourlyLimit || 10)) {
      return {
        isThrottled: true,
        reason: 'HOURLY_LIMIT_REACHED' as const,
        resumesInMinutes,
        nextResetAt: nextHour.toISOString(),
        message: `Campaign hourly limit reached (${campaignHourlySent}/${campaign.hourlyLimit}). Paused until next hour.`,
      };
    }

    // Evaluate each mailbox in pool
    const mailboxUsage = await Promise.all(
      pool.map(async (m) => {
        const dailyLimit = m.state === MailboxState.WARMING ? m.warmupDailyLimit : m.dailySendingLimit;
        const dailyReached = m.sentCountToday >= dailyLimit;
        const hourlySent = await this.mailboxesService.getMailboxHourlySentCount(m.id);
        const hourlyReached = hourlySent >= (m.hourlyLimit || 10);
        return { dailyReached, hourlyReached };
      }),
    );

    const allDailyReached = mailboxUsage.every((u) => u.dailyReached);
    if (allDailyReached) {
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const minutesToMidnight = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60000));
      return {
        isThrottled: true,
        reason: 'DAILY_LIMIT_REACHED' as const,
        resumesInMinutes: minutesToMidnight,
        nextResetAt: midnight.toISOString(),
        message: 'All mailboxes reached daily limit. Paused until tomorrow.',
      };
    }

    const allExhausted = mailboxUsage.every((u) => u.dailyReached || u.hourlyReached);
    if (allExhausted) {
      return {
        isThrottled: true,
        reason: 'HOURLY_LIMIT_REACHED' as const,
        resumesInMinutes,
        nextResetAt: nextHour.toISOString(),
        message: 'All mailboxes reached hourly sending limit. Paused until next hour.',
      };
    }

    return { isThrottled: false };
  }

  async getStats(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        campaignLeadLists: { select: { leadListId: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Use the frozen snapshot count if available; fallback to list calculation for legacy records
    const snapshotCount = await this.prisma.campaignRecipient.count({
      where: { campaignId: id },
    });

    let totalRecipients = snapshotCount;
    if (totalRecipients === 0) {
      const assignedLists = campaign.campaignLeadLists.map((cl) => cl.leadListId);
      const excludedLists = campaign.excludedLeadListIds || [];
      const validListIds = assignedLists.filter((listId) => !excludedLists.includes(listId));

      if (validListIds.length > 0) {
        const distinctLeads = await this.prisma.lead.findMany({
          where: { leadListId: { in: validListIds } },
          select: { email: true },
          distinct: ['email'],
        });
        totalRecipients = distinctLeads.length;
      }
    }

    const [sent, delivered, opened, clicked, bounced, failed] = await Promise.all([
      this.prisma.emailLog.count({ where: { campaignId: id, status: { in: ['SENT', 'DELIVERED'] } } }),
      this.prisma.emailLog.count({ where: { campaignId: id, status: 'DELIVERED' } }),
      this.prisma.emailLog.count({ where: { campaignId: id, openCount: { gt: 0 } } }),
      this.prisma.emailLog.count({ where: { campaignId: id, clickCount: { gt: 0 } } }),
      this.prisma.emailLog.count({ where: { campaignId: id, status: 'BOUNCED' } }),
      this.prisma.emailLog.count({ where: { campaignId: id, status: 'FAILED' } }),
    ]);

    const replies = await this.prisma.inboundReply.count({
      where: { emailLog: { campaignId: id } },
    });

    const throttleStatus = await this.getCampaignThrottleStatus(id).catch(() => ({ isThrottled: false }));

    return {
      totalRecipients,
      sent,
      delivered,
      opened,
      clicked,
      replied: replies,
      bounced,
      failed,
      sentCount: sent,
      deliveredCount: delivered,
      openCount: opened,
      clickCount: clicked,
      replyCount: replies,
      bounceCount: bounced,
      failedCount: failed,
      throttleStatus,
      openRate: sent > 0 ? Number(((opened / sent) * 100).toFixed(1)) : 0,
      clickRate: sent > 0 ? Number(((clicked / sent) * 100).toFixed(1)) : 0,
      replyRate: sent > 0 ? Number(((replies / sent) * 100).toFixed(1)) : 0,
      bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(1)) : 0,
    };
  }

  async remove(id: string) {
    const campaign = await this.findOne(id);
    const deleted = await this.prisma.campaign.delete({ where: { id } });

    await this.auditService.log({
      action: 'CAMPAIGN_DELETE',
      targetEntity: 'Campaign',
      targetId: id,
      metadata: { title: campaign.title },
      status: 'success',
    });

    return deleted;
  }

  /**
   * Dispatches a live test sample email via an attached or available mailbox
   */
  async sendTestEmail(dto: SendTestEmailDto) {
    let mailbox = null;
    if (dto.mailboxId) {
      mailbox = await this.prisma.mailbox.findUnique({ where: { id: dto.mailboxId } });
    }
    if (!mailbox) {
      mailbox = await this.prisma.mailbox.findFirst({
        where: { state: MailboxState.ACTIVE },
      });
    }
    if (!mailbox) {
      mailbox = await this.prisma.mailbox.findFirst();
    }

    if (!mailbox) {
      throw new BadRequestException(
        'No sending mailboxes found. Please configure a mailbox in Email Accounts first.',
      );
    }

    const decryptedConfig = await this.mailboxesService.getDecryptedConfig(mailbox.id);
    const domainHost = mailbox.email.split('@')[1] || 'outreach.internal';
    const messageId = `${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${domainHost}`;

    // Substitute personalization variables with rich test preview data using SpintaxService
    const sampleLead = {
      email: dto.recipientEmail,
      firstName: 'Alex',
      lastName: 'Vance',
      company: 'Acme Corp',
      jobTitle: 'VP Growth',
      country: 'United States',
      city: 'San Francisco',
      website: 'https://acme.example.com',
      linkedIn: 'https://linkedin.com/in/alexvance',
      leadScore: 85,
      customVariables: {
        techStack: 'Next.js & PostgreSQL',
        teamSize: '50-100',
      },
    };

    const senderName =
      (mailbox.senderName && mailbox.senderName.trim()) ||
      (mailbox.displayName && mailbox.displayName.trim()) ||
      (dto.senderName && dto.senderName.trim()) ||
      'Outreach Director';

    const variables = this.spintaxService.buildVariableContext(
      sampleLead,
      { ...mailbox, senderName },
      { title: 'Test Preview Campaign' },
    );

    const finalSubject = `[TEST PREVIEW] ${this.spintaxService.render(dto.subject, variables)}`;
    const finalHtml = this.spintaxService.render(dto.bodyContent, variables);

    const fromAddress = senderName
      ? `"${senderName.replace(/"/g, '')}" <${mailbox.email.trim()}>`
      : mailbox.email.trim();

    const result = await this.providerAdaptersService.dispatch(
      mailbox.type,
      decryptedConfig,
      {
        to: dto.recipientEmail,
        from: fromAddress,
        subject: finalSubject,
        html: finalHtml,
        messageId,
      },
    );

    if (!result.success) {
      throw new BadRequestException(
        result.error || 'Failed to dispatch test email via mailbox provider',
      );
    }

    return {
      success: true,
      message: `Test email dispatched to ${dto.recipientEmail} via ${mailbox.email}`,
      messageId: result.messageId,
    };
  }

  /**
   * Immediately triggers queue evaluation for a campaign
   */
  async triggerCampaign(id: string) {
    const campaign = await this.findOne(id);
    const leadLists = campaign.campaignLeadLists.map((cl) => cl.leadListId);

    if (leadLists.length > 0) {
      await this.prisma.lead.updateMany({
        where: {
          leadListId: { in: leadLists },
          status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
        },
        data: {
          nextScheduledAt: new Date(),
        },
      });
    }

    await this.campaignScheduler.evaluateSchedules(id, true);
    return { success: true, message: `Dispatched campaign ${campaign.title}` };
  }

  /**
   * Generates a preview sequence of calculated delays without mutating campaign state
   */
  previewDelays(dto: PreviewDelaysDto) {
    return this.emailDelayService.generatePreviewSequence(
      {
        mode: dto.mode,
        minimumDelaySeconds: dto.minimumDelaySeconds ?? 10,
        maximumDelaySeconds: dto.maximumDelaySeconds,
        seed: dto.seed,
      },
      dto.count ?? 10,
    );
  }
}

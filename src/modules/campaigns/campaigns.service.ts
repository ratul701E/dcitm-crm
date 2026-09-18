import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { CampaignStatus, LeadStatus } from '@prisma/client';

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCampaignDto) {
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          title: dto.title,
          targetTimezone: dto.targetTimezone || 'UTC',
          dailyWindowStart: dto.dailyWindowStart || '09:00',
          dailyWindowEnd: dto.dailyWindowEnd || '17:00',
          activeDays: dto.activeDays || [1, 2, 3, 4, 5],
          maxNewLeadsPerDay: dto.maxNewLeadsPerDay || 50,
          trackOpens: dto.trackOpens !== undefined ? dto.trackOpens : true,
          trackClicks: dto.trackClicks !== undefined ? dto.trackClicks : true,
          createdById: userId,
        },
      });

      // Attach mailboxes if provided
      if (dto.mailboxIds && dto.mailboxIds.length > 0) {
        await tx.campaignMailbox.createMany({
          data: dto.mailboxIds.map((mailboxId) => ({
            campaignId: campaign.id,
            mailboxId,
          })),
        });
      }

      // Attach lead lists if provided
      if (dto.leadListIds && dto.leadListIds.length > 0) {
        await tx.campaignLeadList.createMany({
          data: dto.leadListIds.map((leadListId) => ({
            campaignId: campaign.id,
            leadListId,
          })),
        });
      }

      // Automatically create the initial default sequence container
      await tx.sequence.create({
        data: {
          campaignId: campaign.id,
          title: `${dto.title} Sequence`,
        },
      });

      return campaign;
    });
  }

  async findAll() {
    return this.prisma.campaign.findMany({
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
        _count: {
          select: {
            emailLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // Update basic fields
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
          trackOpens: dto.trackOpens,
          trackClicks: dto.trackClicks,
        },
      });

      // Update mailbox pool associations if explicitly provided
      if (dto.mailboxIds) {
        await tx.campaignMailbox.deleteMany({ where: { campaignId: id } });
        if (dto.mailboxIds.length > 0) {
          await tx.campaignMailbox.createMany({
            data: dto.mailboxIds.map((mailboxId) => ({
              campaignId: id,
              mailboxId,
            })),
          });
        }
      }

      // Update lead list associations if explicitly provided
      if (dto.leadListIds) {
        await tx.campaignLeadList.deleteMany({ where: { campaignId: id } });
        if (dto.leadListIds.length > 0) {
          await tx.campaignLeadList.createMany({
            data: dto.leadListIds.map((leadListId) => ({
              campaignId: id,
              leadListId,
            })),
          });
        }
      }

      // If campaign transitions to ACTIVE, prime initial nextScheduledAt for uncontacted leads
      if (dto.status === CampaignStatus.ACTIVE) {
        const leadLists = await tx.campaignLeadList.findMany({
          where: { campaignId: id },
          select: { leadListId: true },
        });
        const leadListIds = leadLists.map((l) => l.leadListId);

        if (leadListIds.length > 0) {
          await tx.lead.updateMany({
            where: {
              leadListId: { in: leadListIds },
              status: LeadStatus.NEW,
              nextScheduledAt: null,
            },
            data: {
              nextScheduledAt: new Date(),
            },
          });
        }
      }

      return updated;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.campaign.delete({ where: { id } });
  }
}

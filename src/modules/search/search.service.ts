import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchResultGroup {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  leadCount: number;
  updatedAt: Date;
}

export interface SearchResultLead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  company: string | null;
  jobTitle: string | null;
  status: string;
  leadScore: number;
  verificationStatus: string;
  leadListId: string;
  leadListName: string | null;
  updatedAt: Date;
}

export interface SearchResultCampaign {
  id: string;
  title: string;
  status: string;
  campaignType: string;
  recipientCount: number;
  updatedAt: Date;
}

export interface UnifiedSearchResponse {
  query: string;
  results: {
    groups: SearchResultGroup[];
    leads: SearchResultLead[];
    campaigns: SearchResultCampaign[];
  };
  counts: {
    groups: number;
    leads: number;
    campaigns: number;
    total: number;
  };
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async searchGlobal(query: string, limit = 5): Promise<UnifiedSearchResponse> {
    const term = (query || '').trim();

    if (!term) {
      return {
        query: '',
        results: {
          groups: [],
          leads: [],
          campaigns: [],
        },
        counts: {
          groups: 0,
          leads: 0,
          campaigns: 0,
          total: 0,
        },
      };
    }

    const [groupsRaw, leadsRaw, campaignsRaw] = await Promise.all([
      // 1. Search Groups / Lead Lists
      this.prisma.leadList.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { leads: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),

      // 2. Search Leads / Contacts
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { company: { contains: term, mode: 'insensitive' } },
            { jobTitle: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          company: true,
          jobTitle: true,
          status: true,
          leadScore: true,
          verificationStatus: true,
          leadListId: true,
          leadList: {
            select: {
              id: true,
              name: true,
            },
          },
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),

      // 3. Search Campaigns
      this.prisma.campaign.findMany({
        where: {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { campaignType: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          campaignType: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { recipients: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const groups: SearchResultGroup[] = groupsRaw.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isSystem: g.isSystem,
      leadCount: g._count.leads,
      updatedAt: g.updatedAt,
    }));

    const leads: SearchResultLead[] = leadsRaw.map((l) => ({
      id: l.id,
      email: l.email,
      firstName: l.firstName,
      lastName: l.lastName,
      fullName: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.email,
      company: l.company,
      jobTitle: l.jobTitle,
      status: l.status,
      leadScore: l.leadScore,
      verificationStatus: l.verificationStatus,
      leadListId: l.leadListId,
      leadListName: l.leadList?.name ?? null,
      updatedAt: l.updatedAt,
    }));

    const campaigns: SearchResultCampaign[] = campaignsRaw.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      campaignType: c.campaignType,
      recipientCount: c._count.recipients,
      updatedAt: c.updatedAt,
    }));

    return {
      query: term,
      results: {
        groups,
        leads,
        campaigns,
      },
      counts: {
        groups: groups.length,
        leads: leads.length,
        campaigns: campaigns.length,
        total: groups.length + leads.length + campaigns.length,
      },
    };
  }
}

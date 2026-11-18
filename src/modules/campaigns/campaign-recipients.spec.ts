jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  Interval: () => () => {},
  Timeout: () => () => {},
  CronExpression: {
    EVERY_HOUR: '0 * * * *',
    EVERY_MINUTE: '* * * * *',
    EVERY_30_SECONDS: '*/30 * * * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProviderAdaptersService } from '../dispatcher/provider-adapters.service';
import { CampaignSchedulerService } from '../scheduler/campaign-scheduler.service';
import { SpintaxService } from '../spintax/spintax.service';
import { EmailDelayService } from './email-delay.service';
import { CampaignStatus, LeadStatus } from '@prisma/client';

describe('Campaign Recipient Snapshot & Immutability', () => {
  let service: CampaignsService;

  const mockPrisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    campaign: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    campaignRecipient: {
      createMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    campaignLeadList: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    campaignMailbox: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    sequence: {
      create: jest.fn().mockResolvedValue({ id: 'seq-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'seq-1', steps: [{ id: 'step-1', stepOrder: 1 }] }),
    },
    sequenceStep: {
      create: jest.fn().mockResolvedValue({ id: 'step-1' }),
    },
    sequenceVariant: {
      create: jest.fn(),
    },
    leadList: {
      findMany: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    emailLog: {
      count: jest.fn().mockResolvedValue(0),
    },
    inboundReply: {
      count: jest.fn().mockResolvedValue(0),
    },
  };

  const mockAudit = { log: jest.fn() };
  const mockMailboxes = { getAvailableMailboxForCampaign: jest.fn() };
  const mockProvider = {};
  const mockScheduler = {
    evaluateSchedules: jest.fn(),
    checkAndFinalizeCampaignStatus: jest.fn(),
  };
  const mockSpintax = {};
  const mockDelay = { generateSecureSeed: () => 'test_seed' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: MailboxesService, useValue: mockMailboxes },
        { provide: ProviderAdaptersService, useValue: mockProvider },
        { provide: CampaignSchedulerService, useValue: mockScheduler },
        { provide: SpintaxService, useValue: mockSpintax },
        { provide: EmailDelayService, useValue: mockDelay },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
    jest.clearAllMocks();
  });

  it('1. Snapshots group members at campaign creation time', async () => {
    const createdCampaign = { id: 'camp-123', title: 'Summer Outreach', status: CampaignStatus.DRAFT };
    mockPrisma.campaign.create.mockResolvedValue(createdCampaign);
    mockPrisma.leadList.findMany.mockResolvedValue([{ id: 'group-xyz' }]);

    const existingLeadsInGroup = [
      { id: 'lead-1', email: 'alice@acme.com', firstName: 'Alice', lastName: 'A', company: 'Acme' },
      { id: 'lead-2', email: 'bob@beta.com', firstName: 'Bob', lastName: 'B', company: 'Beta' },
    ];
    mockPrisma.lead.findMany.mockResolvedValue(existingLeadsInGroup);

    // Mock findOne for return
    mockPrisma.campaign.findUnique.mockResolvedValue({
      ...createdCampaign,
      recipients: existingLeadsInGroup.map((l) => ({ leadId: l.id, lead: l })),
      campaignLeadLists: [{ leadListId: 'group-xyz' }],
    });
    mockPrisma.campaignRecipient.count.mockResolvedValue(2);

    await service.create('user-1', {
      title: 'Summer Outreach',
      leadListIds: ['group-xyz'],
    } as any);

    // Verify snapshot records were inserted into CampaignRecipient
    expect(mockPrisma.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ campaignId: 'camp-123', leadId: 'lead-1', email: 'alice@acme.com' }),
        expect.objectContaining({ campaignId: 'camp-123', leadId: 'lead-2', email: 'bob@beta.com' }),
      ]),
      skipDuplicates: true,
    });
  });

  it('2. Total recipients in getStats uses the frozen snapshot count regardless of group changes', async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-completed',
      title: 'Completed Campaign',
      status: CampaignStatus.COMPLETED,
      campaignLeadLists: [{ leadListId: 'group-xyz' }],
    });

    // Exactly 3 recipients were snapshotted
    mockPrisma.campaignRecipient.count.mockResolvedValue(3);

    const stats = await service.getStats('camp-completed');

    expect(stats.totalRecipients).toBe(3);
    // Should NOT re-query the lead table for group-xyz
    expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('3. Updating group attachments on COMPLETED campaign does not alter the frozen snapshot', async () => {
    const completedCampaign = {
      id: 'camp-completed',
      status: CampaignStatus.COMPLETED,
      title: 'Old Outreach',
      recipients: [{ id: 'r1', leadId: 'lead-1' }],
      campaignLeadLists: [{ leadListId: 'group-xyz' }],
    };
    mockPrisma.campaign.findUnique.mockResolvedValue(completedCampaign);
    mockPrisma.campaign.update.mockResolvedValue(completedCampaign);

    await service.update('camp-completed', {
      leadListIds: ['group-new-123'],
    } as any);

    // Verify campaignRecipient.deleteMany was NOT called
    expect(mockPrisma.campaignRecipient.deleteMany).not.toHaveBeenCalled();
  });

  it('4. Computes totalExpectedSends, pendingSends, and deliveryRate accurately for multi-phase campaigns', async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-multi',
      title: 'Multi-Phase Campaign',
      status: CampaignStatus.ACTIVE,
      campaignLeadLists: [{ leadListId: 'group-xyz' }],
      sequences: [
        {
          steps: [
            { id: 's1', stepOrder: 1, isArchived: false },
            { id: 's2', stepOrder: 2, isArchived: false },
          ],
        },
      ],
    });

    // 10 recipients total, 2 phases -> 20 expected sends
    mockPrisma.campaignRecipient.count.mockResolvedValue(10);
    // 10 emails sent so far (phase 1 finished)
    mockPrisma.emailLog.count.mockImplementation(({ where }: any) => {
      if (where.status?.in) return Promise.resolve(10); // sent
      if (where.status === 'DELIVERED') return Promise.resolve(0); // raw DELIVERED status from SMTP is 0
      if (where.status === 'BOUNCED') return Promise.resolve(1);
      if (where.status === 'FAILED') return Promise.resolve(0);
      if (where.openCount) return Promise.resolve(4);
      return Promise.resolve(0);
    });

    const stats = await service.getStats('camp-multi');

    expect(stats.totalRecipients).toBe(10);
    expect(stats.totalPhases).toBe(2);
    expect(stats.totalExpectedSends).toBe(20);
    expect(stats.sentCount).toBe(10);
    // Effective delivered = sent (10) - bounced (1) = 9
    expect(stats.deliveredCount).toBe(9);
    // Pending sends = 20 - 10 - 1 = 9
    expect(stats.pendingSends).toBe(9);
    // Open rate = 4 / 9 = 44.4%
    expect(stats.openRate).toBe(44.4);
    // Delivery rate = 9 / 10 = 90%
    expect(stats.deliveryRate).toBe(90);
  });
});

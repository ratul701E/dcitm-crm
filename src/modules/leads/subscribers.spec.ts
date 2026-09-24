import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadsService, SYSTEM_SUBSCRIBERS_LIST_NAME } from './leads.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('Subscribers Static List Feature', () => {
  let service: LeadsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    leadList: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      createMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('1. Auto-Maintain Subscribers List', () => {
    it('should return existing system Subscribers list if present', async () => {
      const mockList = { id: 'list-123', name: SYSTEM_SUBSCRIBERS_LIST_NAME, isSystem: true };
      mockPrismaService.leadList.findFirst.mockResolvedValueOnce(mockList);

      const result = await service.getOrCreateSubscribersList();
      expect(result).toEqual(mockList);
      expect(mockPrismaService.leadList.create).not.toHaveBeenCalled();
    });

    it('should auto-create system Subscribers list if it does not exist', async () => {
      mockPrismaService.leadList.findFirst
        .mockResolvedValueOnce(null) // isSystem=true
        .mockResolvedValueOnce(null); // name=Subscribers
      
      const createdList = { id: 'list-new', name: SYSTEM_SUBSCRIBERS_LIST_NAME, isSystem: true };
      mockPrismaService.leadList.create.mockResolvedValueOnce(createdList);

      const result = await service.getOrCreateSubscribersList();
      expect(result).toEqual(createdList);
      expect(mockPrismaService.leadList.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: SYSTEM_SUBSCRIBERS_LIST_NAME,
          isSystem: true,
        }),
        include: { _count: { select: { leads: true } } },
      });
    });
  });

  describe('2. System Name Protection', () => {
    it('should reject user attempts to create a custom list named "Subscribers"', async () => {
      await expect(
        service.createList({ name: 'Subscribers', description: 'User custom list' } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createList({ name: 'subscribers', description: 'User custom list' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject deletion of system lists', async () => {
      mockPrismaService.leadList.findUnique.mockResolvedValueOnce({
        id: 'sys-list',
        name: 'Subscribers',
        isSystem: true,
      });

      await expect(service.deleteList('sys-list')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. Enroll in Subscribers List', () => {
    it('should throw BadRequestException for invalid or missing email', async () => {
      await expect(service.enrollInSubscribersList('')).rejects.toThrow(BadRequestException);
      await expect(service.enrollInSubscribersList('invalid-email')).rejects.toThrow(BadRequestException);
    });

    it('should enroll brand new email without prior matched leads', async () => {
      const mockList = { id: 'sys-list', name: 'Subscribers', isSystem: true };
      mockPrismaService.leadList.findFirst.mockResolvedValueOnce(mockList);
      mockPrismaService.lead.findMany.mockResolvedValueOnce([]); // No existing leads
      mockPrismaService.lead.upsert.mockResolvedValueOnce({
        id: 'lead-1',
        email: 'newuser@example.com',
        tags: ['Subscriber'],
        leadListId: 'sys-list',
      });

      const result = await service.enrollInSubscribersList('newuser@example.com');
      expect(result.success).toBe(true);
      expect(result.matchedExistingRecords).toBe(0);
      expect(mockPrismaService.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            leadListId_email: {
              leadListId: 'sys-list',
              email: 'newuser@example.com',
            },
          },
        }),
      );
    });

    it('should match existing lead across other lists and copy rich contact details into Subscribers list', async () => {
      const mockList = { id: 'sys-list', name: 'Subscribers', isSystem: true };
      mockPrismaService.leadList.findFirst.mockResolvedValueOnce(mockList);
      
      const priorLeads = [
        {
          id: 'lead-old',
          leadListId: 'other-list-1',
          email: 'sarah.connor@cyberdyne.com',
          firstName: 'Sarah',
          lastName: 'Connor',
          company: 'Resistance HQ',
          jobTitle: 'Commander',
          tags: ['VIP', 'High-Intent'],
          customVariables: { sector: 'Defense' },
          leadScore: 85,
        },
      ];
      mockPrismaService.lead.findMany.mockResolvedValueOnce(priorLeads);
      mockPrismaService.lead.upsert.mockResolvedValueOnce({
        id: 'lead-subscriber',
        leadListId: 'sys-list',
        email: 'sarah.connor@cyberdyne.com',
        firstName: 'Sarah',
        lastName: 'Connor',
        company: 'Resistance HQ',
        jobTitle: 'Commander',
        tags: ['VIP', 'High-Intent', 'Subscriber'],
        customVariables: { sector: 'Defense' },
        leadScore: 85,
      });

      const result = await service.enrollInSubscribersList('sarah.connor@cyberdyne.com');
      expect(result.success).toBe(true);
      expect(result.matchedExistingRecords).toBe(1);
      expect(result.lead.firstName).toBe('Sarah');
      expect(result.lead.company).toBe('Resistance HQ');
      expect(mockPrismaService.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            firstName: 'Sarah',
            company: 'Resistance HQ',
            tags: expect.arrayContaining(['Subscriber', 'VIP']),
          }),
        }),
      );
    });
  });
});

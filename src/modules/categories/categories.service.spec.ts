import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('CategoriesService (Hierarchical Audience Groups)', () => {
  let service: CategoriesService;

  const mockPrisma: any = {
    $transaction: jest.fn(async (cb: any) => (typeof cb === 'function' ? cb(mockPrisma) : cb)),
    category: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    leadList: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    campaign: {
      findMany: jest.fn(),
    },
    campaignCategory: {
      findMany: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('Hierarchy Constraints (Strict 3 Levels)', () => {
    it('creates an Industry at Level 1 when parentId is omitted', async () => {
      mockPrisma.category.findFirst.mockResolvedValueOnce(null);
      mockPrisma.category.create.mockResolvedValueOnce({
        id: 'ind-1',
        name: 'Restaurants',
        level: 1,
        parentId: null,
        sortOrder: 0,
      });

      const result = await service.createCategory('user-1', { name: 'Restaurants' });
      expect(result.level).toBe(1);
      expect(result.parentId).toBeNull();
      expect(mockPrisma.category.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ level: 1, parentId: null, name: 'Restaurants' }),
      });
    });

    it('creates a Subcategory at Level 2 when parent is Level 1 Industry', async () => {
      mockPrisma.category.findUnique.mockResolvedValueOnce({ id: 'ind-1', level: 1, name: 'Restaurants' });
      mockPrisma.category.findFirst.mockResolvedValueOnce(null);
      mockPrisma.category.create.mockResolvedValueOnce({
        id: 'sub-1',
        name: 'BBQ Restaurants',
        level: 2,
        parentId: 'ind-1',
        sortOrder: 0,
      });

      const result = await service.createCategory('user-1', {
        name: 'BBQ Restaurants',
        parentId: 'ind-1',
      });
      expect(result.level).toBe(2);
      expect(result.parentId).toBe('ind-1');
    });

    it('throws BadRequestException when attempting to nest under a Level 2 Subcategory (preventing 4th level)', async () => {
      mockPrisma.category.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        level: 2,
        name: 'BBQ Restaurants',
      });

      await expect(
        service.createCategory('user-1', {
          name: 'Texas BBQ',
          parentId: 'sub-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on duplicate category name under the same parent', async () => {
      mockPrisma.category.findUnique.mockResolvedValueOnce({ id: 'ind-1', level: 1 });
      mockPrisma.category.findFirst.mockResolvedValueOnce({ id: 'sub-existing', name: 'BBQ Restaurants' });

      await expect(
        service.createCategory('user-1', {
          name: 'BBQ Restaurants',
          parentId: 'ind-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Audience Group Move Constraints', () => {
    it('throws BadRequestException when placing an audience group directly under a Level 1 Industry', async () => {
      mockPrisma.leadList.findUnique.mockResolvedValueOnce({
        id: 'group-1',
        name: 'Texas BBQ Leads',
        isSystem: false,
      });
      mockPrisma.category.findUnique.mockResolvedValueOnce({
        id: 'ind-1',
        level: 1,
        name: 'Restaurants',
      });

      await expect(
        service.moveLeadList('group-1', { targetParentCategoryId: 'ind-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows placing an audience group under a Level 2 Subcategory', async () => {
      mockPrisma.leadList.findUnique.mockResolvedValueOnce({
        id: 'group-1',
        name: 'Texas BBQ Leads',
        isSystem: false,
        parentCategory: null,
      });
      mockPrisma.category.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        level: 2,
        name: 'BBQ Restaurants',
        parent: { name: 'Restaurants' },
      });
      mockPrisma.campaign.findMany.mockResolvedValueOnce([]);
      mockPrisma.leadList.update.mockResolvedValueOnce({
        id: 'group-1',
        parentCategoryId: 'sub-1',
      });

      const result = await service.moveLeadList('group-1', { targetParentCategoryId: 'sub-1' });
      expect(result.toPath).toBe('Restaurants / BBQ Restaurants');
      expect(mockPrisma.leadList.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { parentCategoryId: 'sub-1' },
      });
    });

    it('allows moving an audience group to Unassigned lists (null)', async () => {
      mockPrisma.leadList.findUnique.mockResolvedValueOnce({
        id: 'group-1',
        name: 'Texas BBQ Leads',
        isSystem: false,
        parentCategory: { name: 'BBQ Restaurants', parent: { name: 'Restaurants' } },
      });
      mockPrisma.campaign.findMany.mockResolvedValueOnce([]);
      mockPrisma.leadList.update.mockResolvedValueOnce({
        id: 'group-1',
        parentCategoryId: null,
      });

      const result = await service.moveLeadList('group-1', { targetParentCategoryId: null });
      expect(result.toPath).toBe('Unassigned lists');
    });

    it('rejects moving system lists (Subscribers)', async () => {
      mockPrisma.leadList.findUnique.mockResolvedValueOnce({
        id: 'subscribers-list',
        name: 'Subscribers',
        isSystem: true,
      });

      await expect(
        service.moveLeadList('subscribers-list', { targetParentCategoryId: 'sub-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Non-destructive Delete Category', () => {
    it('requires exact confirmation name to delete', async () => {
      mockPrisma.category.findUnique.mockResolvedValueOnce({
        id: 'ind-1',
        name: 'Restaurants',
        children: [],
        audienceGroups: [],
      });

      await expect(
        service.deleteCategory('ind-1', {
          confirmationName: 'Wrong Name',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cascades groups to Unassigned lists without deleting contacts or groups', async () => {
      mockPrisma.category.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        name: 'BBQ Restaurants',
        level: 2,
        children: [],
        audienceGroups: [{ id: 'group-1' }],
      });
      mockPrisma.campaign.findMany.mockResolvedValueOnce([]);
      mockPrisma.leadList.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.category.delete.mockResolvedValueOnce({ id: 'sub-1' });

      const result = await service.deleteCategory('sub-1', {
        confirmationName: 'BBQ Restaurants',
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.leadList.updateMany).toHaveBeenCalledWith({
        where: { parentCategoryId: 'sub-1' },
        data: { parentCategoryId: null },
      });
    });
  });
});

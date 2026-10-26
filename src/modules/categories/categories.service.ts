import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  MoveCategoryDto,
  DeleteCategoryDto,
  ReorderCategoriesDto,
  MoveLeadListDto,
} from './dto/category.dto';
import { CampaignStatus, LeadStatus } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns the entire 3-level hierarchy tree (Industry -> Subcategory -> Audience Group),
   * plus virtual Unassigned Lists, along with aggregated statistics for each node.
   */
  async getHierarchyTree(search?: string) {
    // 1. Fetch all categories with parent/children and their audience groups
    const categories = await this.prisma.category.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        audienceGroups: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            isSystem: true,
            parentCategoryId: true,
            sortOrder: true,
            updatedAt: true,
            createdAt: true,
            _count: {
              select: {
                leads: {
                  where: { deletedAt: null },
                },
              },
            },
          },
        },
      },
    });

    // 2. Fetch unassigned audience groups (parentCategoryId is null)
    const unassignedGroups = await this.prisma.leadList.findMany({
      where: { parentCategoryId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        parentCategoryId: true,
        sortOrder: true,
        updatedAt: true,
        createdAt: true,
        _count: {
          select: {
            leads: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    // 3. Calculate distinct active reachable contacts across all groups for top stats
    const allActiveLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
      },
      select: { email: true },
    });
    const uniqueEmailSet = new Set(allActiveLeads.map((l) => l.email.trim().toLowerCase()));

    const totalRecordsEnrolled = await this.prisma.lead.count({
      where: { deletedAt: null },
    });

    const totalAudienceGroups = await this.prisma.leadList.count();

    // 4. Build the structured tree
    const industries = categories.filter((c) => c.level === 1);
    const subcategories = categories.filter((c) => c.level === 2);

    const tree = industries.map((ind) => {
      const childSubs = subcategories
        .filter((sub) => sub.parentId === ind.id)
        .map((sub) => {
          const groups = sub.audienceGroups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            isSystem: g.isSystem,
            parentCategoryId: g.parentCategoryId,
            sortOrder: g.sortOrder,
            contactsCount: g._count.leads,
            contactCount: g._count.leads,
            updatedAt: g.updatedAt,
            createdAt: g.createdAt,
          }));

          const subContactsCount = groups.reduce((acc, g) => acc + g.contactsCount, 0);

          return {
            id: sub.id,
            name: sub.name,
            description: sub.description,
            parentId: sub.parentId,
            level: 2,
            sortOrder: sub.sortOrder,
            groupsCount: groups.length,
            groupCount: groups.length,
            contactsCount: subContactsCount,
            contactCount: subContactsCount,
            groups,
          };
        });

      const indGroupsCount = childSubs.reduce((acc, s) => acc + s.groupsCount, 0);
      const indContactsCount = childSubs.reduce((acc, s) => acc + s.contactsCount, 0);

      return {
        id: ind.id,
        name: ind.name,
        description: ind.description,
        parentId: null,
        level: 1,
        sortOrder: ind.sortOrder,
        groupsCount: indGroupsCount,
        totalGroups: indGroupsCount,
        contactsCount: indContactsCount,
        totalContacts: indContactsCount,
        totalSubcategories: childSubs.length,
        subcategories: childSubs,
      };
    });

    const unassignedListRecords = unassignedGroups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isSystem: g.isSystem,
      parentCategoryId: null,
      sortOrder: g.sortOrder,
      contactsCount: g._count.leads,
      contactCount: g._count.leads,
      updatedAt: g.updatedAt,
      createdAt: g.createdAt,
    }));

    const unassignedContactsCount = unassignedListRecords.reduce((acc, g) => acc + g.contactsCount, 0);

    const statsObj = {
      totalCategories: categories.length,
      totalIndustries: industries.length,
      totalSubcategories: subcategories.length,
      totalGroups: totalAudienceGroups,
      totalCategorizedGroups: totalAudienceGroups - unassignedGroups.length,
      categorizedGroups: totalAudienceGroups - unassignedGroups.length,
      totalUnassignedGroups: unassignedGroups.length,
      unassignedGroups: unassignedGroups.length,
      totalContacts: totalRecordsEnrolled,
      uniqueContacts: uniqueEmailSet.size,
      uniqueReachable: uniqueEmailSet.size,
    };

    return {
      summary: statsObj,
      stats: statsObj,
      tree,
      unassigned: {
        groupsCount: unassignedListRecords.length,
        contactsCount: unassignedContactsCount,
        groups: unassignedListRecords,
      },
      unassignedLists: unassignedListRecords,
    };
  }

  /**
   * Retrieves single category detail with breadcrumb, structure strip, and audience groups table
   */
  async getCategoryDetails(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: {
          select: { id: true, name: true, level: true },
        },
        children: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            audienceGroups: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              select: {
                id: true,
                name: true,
                description: true,
                isSystem: true,
                parentCategoryId: true,
                sortOrder: true,
                updatedAt: true,
                createdAt: true,
                _count: { select: { leads: { where: { deletedAt: null } } } },
              },
            },
          },
        },
        audienceGroups: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            leads: {
              where: { deletedAt: null },
              select: { email: true, status: true },
            },
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    // Breadcrumb path
    const breadcrumb = [
      { id: 'all', name: 'All Categories' },
    ];
    if (category.level === 1) {
      breadcrumb.push({ id: category.id, name: category.name });
    } else if (category.level === 2 && category.parent) {
      breadcrumb.push({ id: category.parent.id, name: category.parent.name });
      breadcrumb.push({ id: category.id, name: category.name });
    }

    if (category.level === 1) {
      // Industry detail: list its subcategories with counts
      const subcategories = category.children.map((sub) => {
        const groupsCount = sub.audienceGroups.length;
        const contactsCount = sub.audienceGroups.reduce(
          (acc, g) => acc + g._count.leads,
          0,
        );
        return {
          id: sub.id,
          name: sub.name,
          description: sub.description,
          groupsCount,
          groupCount: groupsCount,
          contactsCount,
          contactCount: contactsCount,
          sortOrder: sub.sortOrder,
        };
      });

      const totalGroups = subcategories.reduce((acc, s) => acc + s.groupsCount, 0);
      const totalContacts = subcategories.reduce((acc, s) => acc + s.contactsCount, 0);

      // Collect all audience groups belonging to this industry's subcategories
      const allIndustryGroups = category.children.flatMap((sub) =>
        sub.audienceGroups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          isSystem: g.isSystem,
          parentCategoryId: g.parentCategoryId,
          parentCategoryName: `${category.name} / ${sub.name}`,
          contactsCount: g._count.leads,
          contactCount: g._count.leads,
          lastUpdated: g.updatedAt,
          updatedAt: g.updatedAt,
          createdAt: g.createdAt,
          sortOrder: g.sortOrder,
        })),
      );

      // Find all leads under this industry for unique count
      const allIndustryLeads = await this.prisma.lead.findMany({
        where: {
          leadList: {
            parentCategory: {
              parentId: category.id,
            },
          },
          deletedAt: null,
          status: { notIn: [LeadStatus.BOUNCED, LeadStatus.UNSUBSCRIBED, LeadStatus.SUPPRESSED] },
        },
        select: { email: true },
      });
      const uniqueContacts = new Set(allIndustryLeads.map((l) => l.email.trim().toLowerCase())).size;

      return {
        id: category.id,
        name: category.name,
        description: category.description,
        level: category.level,
        levelLabel: 'Industry',
        parentId: null,
        parent: null,
        breadcrumb,
        updatedAt: category.updatedAt,
        stats: {
          subcategoriesCount: subcategories.length,
          audienceGroupsCount: totalGroups,
          groupCount: totalGroups,
          totalContacts,
          uniqueContacts,
        },
        subcategories,
        audienceGroups: allIndustryGroups,
        groups: allIndustryGroups,
      };
    } else {
      // Subcategory detail: list its audience groups
      const groups = category.audienceGroups.map((g) => {
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          isSystem: g.isSystem,
          parentCategoryId: g.parentCategoryId,
          parentCategoryName: `${category.parent?.name || 'Industry'} / ${category.name}`,
          contactsCount: g.leads.length,
          contactCount: g.leads.length,
          lastUpdated: g.updatedAt,
          updatedAt: g.updatedAt,
          createdAt: g.createdAt,
          sortOrder: g.sortOrder,
        };
      });

      const totalRecords = groups.reduce((acc, g) => acc + g.contactsCount, 0);

      // Unique contact deduplication across groups of this subcategory
      const allSubcategoryLeads = category.audienceGroups.flatMap((g) => g.leads);
      const emailCountMap = new Map<string, number>();
      for (const lead of allSubcategoryLeads) {
        const norm = lead.email.trim().toLowerCase();
        emailCountMap.set(norm, (emailCountMap.get(norm) || 0) + 1);
      }
      const uniqueContacts = emailCountMap.size;
      let multiGroupOverlap = 0;
      for (const count of emailCountMap.values()) {
        if (count > 1) multiGroupOverlap += count - 1;
      }

      return {
        id: category.id,
        name: category.name,
        description: category.description,
        level: category.level,
        levelLabel: 'Subcategory',
        parentId: category.parentId,
        parent: category.parent,
        breadcrumb,
        updatedAt: category.updatedAt,
        stats: {
          subcategoriesCount: 0,
          audienceGroupsCount: groups.length,
          groupCount: groups.length,
          totalContacts: totalRecords,
          uniqueContacts,
          multiGroupOverlap,
        },
        subcategories: [],
        audienceGroups: groups,
        groups,
      };
    }
  }

  /**
   * Creates an Industry (parentId null) or Subcategory (parentId non-null).
   * Strict constraint: maximum 3 levels.
   */
  async createCategory(userId: string | null, dto: CreateCategoryDto) {
    let level = 1;
    let parentId: string | null = null;

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`Parent category with ID ${dto.parentId} not found`);
      }
      if (parent.level !== 1) {
        throw new BadRequestException(
          'Hierarchy violation: Cannot create a subcategory inside another subcategory. Maximum depth is 3 levels: Industry -> Subcategory -> Audience Group.',
        );
      }
      level = 2;
      parentId = parent.id;
    }

    // Check duplicate name within the same parent
    const existing = await this.prisma.category.findFirst({
      where: {
        parentId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });
    if (existing) {
      throw new ConflictException(
        `A category named "${dto.name}" already exists in this ${level === 1 ? 'industry' : 'parent industry'} level.`,
      );
    }

    // Determine sort order
    const maxSort = await this.prisma.category.findFirst({
      where: { parentId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = (maxSort?.sortOrder ?? -1) + 1;

    const created = await this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        parentId,
        level,
        sortOrder,
        createdById: userId,
      },
    });

    await this.auditService.log({
      actorUserId: userId || undefined,
      action: 'CATEGORY_CREATE',
      targetEntity: 'Category',
      targetId: created.id,
      metadata: { name: created.name, level: created.level, parentId },
      status: 'success',
    });

    return created;
  }

  /**
   * Updates category name and/or description
   */
  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (dto.name && dto.name.trim() !== category.name) {
      const duplicate = await this.prisma.category.findFirst({
        where: {
          id: { not: id },
          parentId: category.parentId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Category named "${dto.name}" already exists at this level.`);
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
      },
    });
  }

  /**
   * Moves a subcategory to a different industry parent.
   */
  async moveCategory(id: string, dto: MoveCategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }
    if (category.level !== 2) {
      throw new BadRequestException('Only Level 2 Subcategories can be moved to another industry.');
    }

    const targetParentId = dto.targetParentId || (dto as any).newParentId;
    if (!targetParentId) {
      throw new BadRequestException('Target parent industry ID is required.');
    }

    const targetIndustry = await this.prisma.category.findUnique({
      where: { id: targetParentId },
    });
    if (!targetIndustry || targetIndustry.level !== 1) {
      throw new BadRequestException('Target category must be a Level 1 Industry.');
    }

    if (category.parentId === targetIndustry.id) {
      return category; // Already there
    }

    // Check duplicate name in target industry
    const nameConflict = await this.prisma.category.findFirst({
      where: {
        parentId: targetIndustry.id,
        name: { equals: category.name, mode: 'insensitive' },
      },
    });
    if (nameConflict) {
      throw new ConflictException(
        `A subcategory named "${category.name}" already exists in the destination industry "${targetIndustry.name}".`,
      );
    }

    // Check for scheduled campaigns that target source or destination
    const scheduledCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE] },
        campaignCategories: {
          some: { categoryId: { in: [category.id, targetIndustry.id] } },
        },
      },
      select: { id: true, title: true, status: true },
    });

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        parentId: targetIndustry.id,
      },
    });

    return {
      category: updated,
      fromPath: `${category.parent?.name || 'Industry'} / ${category.name}`,
      toPath: `${targetIndustry.name} / ${category.name}`,
      scheduledCampaignsProtectedCount: scheduledCampaigns.length,
      scheduledCampaigns,
      undoPayload: {
        categoryId: id,
        previousParentId: category.parentId,
      },
    };
  }

  /**
   * Batch reorders sibling categories (industries or subcategories)
   */
  async reorderCategories(dto: ReorderCategoriesDto) {
    const ids =
      dto.orderedIds ||
      ((dto as any).items
        ? [...(dto as any).items].sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((i: any) => i.id)
        : []);
    const updates = ids.map((id, index) =>
      this.prisma.category.update({
        where: { id },
        data: { sortOrder: index },
      }),
    );
    await this.prisma.$transaction(updates);
    return { success: true, reorderedCount: ids.length };
  }

  /**
   * Deletes a category with non-destructive preservation of groups and contacts.
   * Requires confirmation name matching.
   */
  async deleteCategory(id: string, dto: DeleteCategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: {
          include: {
            audienceGroups: true,
          },
        },
        audienceGroups: true,
      },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (dto.confirmationName && dto.confirmationName.trim().toLowerCase() !== category.name.trim().toLowerCase()) {
      throw new BadRequestException(
        `Confirmation name "${dto.confirmationName}" does not match category name "${category.name}".`,
      );
    }

    // Check scheduled campaigns
    const scheduledCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE] },
        campaignCategories: { some: { categoryId: id } },
      },
      select: { id: true, title: true, status: true },
    });

    const isMoveSubcategories =
      dto.resolutionOption === 'MOVE_SUBCATEGORIES_TO_ANOTHER_INDUSTRY' ||
      dto.strategy === 'REASSIGN_TO_PARENT';
    const resolvedTargetIndustryId = dto.targetIndustryId || dto.targetCategoryId;

    await this.prisma.$transaction(async (tx) => {
      if (category.level === 1) {
        // Deleting an Industry
        if (isMoveSubcategories) {
          if (!resolvedTargetIndustryId) {
            throw new BadRequestException('Target industry ID is required to move subcategories.');
          }
          const target = await tx.category.findUnique({
            where: { id: resolvedTargetIndustryId },
          });
          if (!target || target.level !== 1 || target.id === id) {
            throw new BadRequestException('Invalid target industry.');
          }

          // Move all child subcategories to the target industry
          await tx.category.updateMany({
            where: { parentId: id },
            data: { parentId: target.id },
          });
        } else {
          // Cascade to unassigned: move all child subcategories' groups to unassigned, then delete subcategories
          const subcategoryIds = category.children.map((c) => c.id);
          if (subcategoryIds.length > 0) {
            await tx.leadList.updateMany({
              where: { parentCategoryId: { in: subcategoryIds } },
              data: { parentCategoryId: null },
            });
            await tx.category.deleteMany({
              where: { id: { in: subcategoryIds } },
            });
          }
        }
      } else {
        // Deleting a Subcategory: move member groups
        if (dto.targetSubcategoryId) {
          const targetSub = await tx.category.findUnique({
            where: { id: dto.targetSubcategoryId },
          });
          if (!targetSub || targetSub.level !== 2 || targetSub.id === id) {
            throw new BadRequestException('Invalid destination subcategory.');
          }
          await tx.leadList.updateMany({
            where: { parentCategoryId: id },
            data: { parentCategoryId: targetSub.id },
          });
        } else {
          // Move groups to unassigned
          await tx.leadList.updateMany({
            where: { parentCategoryId: id },
            data: { parentCategoryId: null },
          });
        }
      }

      // Finally delete the category itself
      await tx.category.delete({ where: { id } });
    });

    return {
      success: true,
      deletedCategory: category.name,
      scheduledCampaignsProtectedCount: scheduledCampaigns.length,
    };
  }

  /**
   * Moves an Audience Group (LeadList) to a subcategory or to Unassigned lists.
   * Strict constraint: Groups can NEVER be placed directly under an Industry!
   */
  async moveLeadList(listId: string, dto: MoveLeadListDto) {
    const list = await this.prisma.leadList.findUnique({
      where: { id: listId },
      include: {
        parentCategory: {
          include: { parent: true },
        },
      },
    });
    if (!list) {
      throw new NotFoundException(`Audience Group with ID ${listId} not found`);
    }

    if (list.isSystem) {
      throw new BadRequestException('System lists (e.g. Subscribers) are locked and cannot be assigned to categories.');
    }

    let targetParentCategoryId: string | null = null;
    let targetCategoryName = 'Unassigned lists';

    const resolvedTargetParentId =
      dto.targetParentCategoryId !== undefined
        ? dto.targetParentCategoryId
        : ((dto as any).parentCategoryId !== undefined
            ? (dto as any).parentCategoryId
            : (dto as any).newParentId);

    if (resolvedTargetParentId) {
      const targetCategory = await this.prisma.category.findUnique({
        where: { id: resolvedTargetParentId },
        include: { parent: true },
      });
      if (!targetCategory) {
        throw new NotFoundException(`Destination category ${resolvedTargetParentId} not found`);
      }
      if (targetCategory.level === 1) {
        throw new BadRequestException(
          'Hierarchy violation: Audience groups cannot be placed directly under an industry. They must belong to a subcategory or be Unassigned.',
        );
      }
      targetParentCategoryId = targetCategory.id;
      targetCategoryName = `${targetCategory.parent?.name || 'Industry'} / ${targetCategory.name}`;
    }

    const scheduledCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE] },
        campaignLeadLists: { some: { leadListId: listId } },
      },
      select: { id: true, title: true },
    });

    const updated = await this.prisma.leadList.update({
      where: { id: listId },
      data: {
        parentCategoryId: targetParentCategoryId,
      },
    });

    return {
      list: updated,
      fromPath: list.parentCategory
        ? `${list.parentCategory.parent?.name || 'Industry'} / ${list.parentCategory.name}`
        : 'Unassigned lists',
      toPath: targetCategoryName,
      scheduledCampaignsProtectedCount: scheduledCampaigns.length,
      undoPayload: {
        listId,
        previousParentCategoryId: list.parentCategoryId,
      },
    };
  }

  /**
   * Batch reorders audience groups within a subcategory or unassigned
   */
  async reorderLeadLists(orderedIds: string[]) {
    const updates = orderedIds.map((id, index) =>
      this.prisma.leadList.update({
        where: { id },
        data: { sortOrder: index },
      }),
    );
    await this.prisma.$transaction(updates);
    return { success: true, reorderedCount: orderedIds.length };
  }

  /**
   * Global search across Categories, Audience Groups, and Contacts with path highlighting
   */
  async globalSearch(query: string) {
    const q = query.trim();
    if (!q) {
      return { categories: [], groups: [], contacts: [] };
    }

    const [categories, groups, contacts] = await Promise.all([
      // Matching categories
      this.prisma.category.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
        },
        include: {
          parent: { select: { id: true, name: true } },
          audienceGroups: {
            select: {
              id: true,
              _count: { select: { leads: { where: { deletedAt: null } } } },
            },
          },
          children: {
            include: {
              audienceGroups: {
                select: {
                  id: true,
                  _count: { select: { leads: { where: { deletedAt: null } } } },
                },
              },
            },
          },
        },
        take: 10,
      }),

      // Matching audience groups
      this.prisma.leadList.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
        },
        include: {
          parentCategory: {
            include: { parent: true },
          },
          _count: {
            select: { leads: { where: { deletedAt: null } } },
          },
        },
        take: 10,
      }),

      // Matching contacts
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { company: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          leadList: {
            include: {
              parentCategory: {
                include: { parent: true },
              },
            },
          },
        },
        take: 10,
      }),
    ]);

    const formattedCategories = categories.map((c) => {
      let groupsCount = 0;
      let contactsCount = 0;
      if (c.level === 1) {
        c.children.forEach((sub) => {
          groupsCount += sub.audienceGroups.length;
          sub.audienceGroups.forEach((g) => {
            contactsCount += g._count.leads;
          });
        });
      } else {
        groupsCount = c.audienceGroups.length;
        contactsCount = c.audienceGroups.reduce((acc, g) => acc + g._count.leads, 0);
      }

      return {
        id: c.id,
        name: c.name,
        level: c.level,
        path: c.parent ? `${c.parent.name} › ${c.name}` : c.name,
        groupsCount,
        contactsCount,
      };
    });

    const formattedGroups = groups.map((g) => ({
      id: g.id,
      name: g.name,
      path: g.parentCategory
        ? `${g.parentCategory.parent?.name || 'Industry'} / ${g.parentCategory.name}`
        : 'Unassigned lists',
      contactsCount: g._count.leads,
    }));

    const formattedContacts = contacts.map((l) => ({
      id: l.id,
      name: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.company || l.email,
      email: l.email,
      company: l.company,
      path: l.leadList.parentCategory
        ? `${l.leadList.parentCategory.parent?.name || 'Industry'} / ${l.leadList.parentCategory.name} › in ${l.leadList.name}`
        : `in ${l.leadList.name}`,
    }));

    return {
      query: q,
      totalResults: formattedCategories.length + formattedGroups.length + formattedContacts.length,
      categories: formattedCategories,
      groups: formattedGroups,
      contacts: formattedContacts,
    };
  }
}

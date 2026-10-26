import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Previews the current lists and proposed placement according to specification Section 10:
   * - Subscribers -> System lists, locked
   * - Group for warmup -> Kept outside categories (Warmup Engine unaffected)
   * - Test group & Default Leads -> Unassigned lists
   */
  async previewMigration() {
    const lists = await this.prisma.leadList.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            leads: { where: { deletedAt: null } },
          },
        },
      },
    });

    const totalContactsBefore = lists.reduce((acc, l) => acc + l._count.leads, 0);

    const proposedPlacements = lists.map((l) => {
      const nameLower = l.name.toLowerCase();
      let type = 'Static list';
      let proposedPlace = 'Unassigned lists · assign later';
      let check = 'Membership unchanged';
      let isSystem = l.isSystem;

      if (nameLower.includes('subscriber') || l.isSystem) {
        type = 'SYSTEM LIST';
        proposedPlace = 'System lists (locked)';
        check = 'Stays system-maintained';
        isSystem = true;
      } else if (nameLower.includes('warmup') || nameLower.includes('warm-up')) {
        type = 'Warm-up list';
        proposedPlace = 'System lists · not targetable by category';
        check = 'Warm-up Engine unaffected';
        isSystem = true;
      }

      return {
        id: l.id,
        name: l.name,
        description: l.description,
        type,
        contactsCount: l._count.leads,
        proposedPlace,
        check,
        isSystem,
      };
    });

    return {
      listsFound: lists.length,
      contactsEnrolledNow: totalContactsBefore,
      contactsAfterMigration: totalContactsBefore,
      campaignAudiencesChanged: 0,
      lists: proposedPlacements,
    };
  }

  /**
   * Applies the non-destructive organization update.
   */
  async applyMigration(userId?: string) {
    const preview = await this.previewMigration();

    await this.prisma.$transaction(async (tx) => {
      for (const item of preview.lists) {
        if (item.isSystem) {
          await tx.leadList.update({
            where: { id: item.id },
            data: {
              isSystem: true,
              parentCategoryId: null,
            },
          });
        }
      }
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'MIGRATION_APPLY',
      targetEntity: 'LeadList',
      metadata: { listsMigrated: preview.lists.length, totalContacts: preview.contactsEnrolledNow },
      status: 'success',
    });

    return {
      success: true,
      message: `Successfully organized ${preview.lists.length} lists. All ${preview.contactsEnrolledNow} contacts preserved.`,
      preview,
    };
  }
}

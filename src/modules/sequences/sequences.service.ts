import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStepDto, UpdateStepDto, ReorderStepsDto } from './dto/sequence.dto';

@Injectable()
export class SequencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves sequence definition and all active steps for a campaign
   */
  async getSequenceByCampaign(campaignId: string) {
    const sequence = await this.prisma.sequence.findFirst({
      where: { campaignId },
      include: {
        steps: {
          where: { isArchived: false },
          orderBy: { stepOrder: 'asc' },
          include: { variants: true },
        },
      },
    });

    if (!sequence) {
      throw new NotFoundException('Sequence not found for campaign');
    }

    return sequence;
  }

  /**
   * Add an ordered step/phase with A/B variants to a sequence
   */
  async addStep(campaignId: string, dto: CreateStepDto) {
    const sequence = await this.getSequenceByCampaign(campaignId);

    // Compute stepOrder if not provided
    let stepOrder = dto.stepOrder ?? (dto as any).position;
    if (!stepOrder) {
      const highestStep = await this.prisma.sequenceStep.findFirst({
        where: { sequenceId: sequence.id, isArchived: false },
        orderBy: { stepOrder: 'desc' },
        select: { stepOrder: true },
      });
      stepOrder = (highestStep?.stepOrder ?? 0) + 1;
    }

    const title = dto.title?.trim() || `Phase ${stepOrder}`;

    // Normalize variants or shorthand subject/body
    let variants = dto.variants;
    if (!variants || variants.length === 0) {
      if (dto.subject && dto.body) {
        variants = [
          {
            variantKey: 'A',
            weight: 100,
            subject: dto.subject,
            body: dto.body,
          },
        ];
      } else {
        throw new BadRequestException('Either variants array or both subject and body must be provided');
      }
    }

    const normalizedVariants = variants.map((v, idx) => ({
      ...v,
      variantKey: v.variantKey || String.fromCharCode(65 + idx),
      weight: v.weight ?? (variants.length === 1 ? 100 : Math.floor(100 / variants.length)),
    }));

    const totalWeight = normalizedVariants.reduce((acc, v) => acc + (v.weight || 0), 0);
    if (totalWeight !== 100) {
      if (normalizedVariants.length === 1) {
        normalizedVariants[0].weight = 100;
      } else {
        throw new BadRequestException(
          `Total weight of step variants must equal 100% (currently ${totalWeight}%)`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const step = await tx.sequenceStep.create({
        data: {
          sequenceId: sequence.id,
          title,
          stepOrder,
          delayDays: dto.delayDays !== undefined ? dto.delayDays : 0,
          delayHours: dto.delayHours !== undefined ? dto.delayHours : 0,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          status: 'ACTIVE',
          isArchived: false,
        },
      });

      await tx.sequenceVariant.createMany({
        data: normalizedVariants.map((v) => ({
          sequenceStepId: step.id,
          variantKey: v.variantKey,
          weight: v.weight,
          subject: v.subject,
          body: v.body,
        })),
      });

      return tx.sequenceStep.findUnique({
        where: { id: step.id },
        include: { variants: true },
      });
    });
  }

  /**
   * Update step title, delays, status, or copy variants
   */
  async updateStep(stepId: string, dto: UpdateStepDto) {
    const existingStep = await this.prisma.sequenceStep.findUnique({
      where: { id: stepId },
      include: { variants: true },
    });
    if (!existingStep) {
      throw new NotFoundException('Sequence step not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // If variants are provided, replace them
      if (dto.variants && dto.variants.length > 0) {
        const variants = dto.variants.map((v, idx) => ({
          ...v,
          variantKey: v.variantKey || String.fromCharCode(65 + idx),
          weight: v.weight ?? (dto.variants!.length === 1 ? 100 : Math.floor(100 / dto.variants!.length)),
        }));
        const totalWeight = variants.reduce((acc, v) => acc + (v.weight || 0), 0);
        if (totalWeight !== 100) {
          if (variants.length === 1) {
            variants[0].weight = 100;
          } else {
            throw new BadRequestException(
              `Total weight of step variants must equal 100% (currently ${totalWeight}%)`,
            );
          }
        }

        // Replace variants
        await tx.sequenceVariant.deleteMany({ where: { sequenceStepId: stepId } });
        await tx.sequenceVariant.createMany({
          data: variants.map((v) => ({
            sequenceStepId: stepId,
            variantKey: v.variantKey,
            weight: v.weight,
            subject: v.subject,
            body: v.body,
          })),
        });
      } else if (dto.subject || dto.body) {
        // Shorthand update to existing variant A or first variant
        const firstVariant = existingStep.variants[0];
        if (firstVariant) {
          await tx.sequenceVariant.update({
            where: { id: firstVariant.id },
            data: {
              subject: dto.subject ?? firstVariant.subject,
              body: dto.body ?? firstVariant.body,
            },
          });
        }
      }

      return tx.sequenceStep.update({
        where: { id: stepId },
        data: {
          title: dto.title !== undefined ? dto.title.trim() : undefined,
          delayDays: dto.delayDays,
          delayHours: dto.delayHours,
          scheduledAt: dto.scheduledAt !== undefined ? (dto.scheduledAt ? new Date(dto.scheduledAt) : null) : undefined,
          status: dto.status,
        },
        include: { variants: true },
      });
    });
  }

  /**
   * Reorder sequence steps
   */
  async reorderSteps(campaignId: string, stepIds: string[]) {
    const sequence = await this.getSequenceByCampaign(campaignId);

    const existingSteps = await this.prisma.sequenceStep.findMany({
      where: { sequenceId: sequence.id, id: { in: stepIds } },
    });

    if (existingSteps.length !== stepIds.length) {
      throw new BadRequestException('One or more step IDs do not belong to this campaign sequence');
    }

    return this.prisma.$transaction(async (tx) => {
      // Set temporary negative stepOrder to avoid unique constraint collisions during swap
      for (let i = 0; i < stepIds.length; i++) {
        await tx.sequenceStep.update({
          where: { id: stepIds[i] },
          data: { stepOrder: -(i + 1) },
        });
      }

      // Set real stepOrder 1, 2, 3...
      for (let i = 0; i < stepIds.length; i++) {
        await tx.sequenceStep.update({
          where: { id: stepIds[i] },
          data: { stepOrder: i + 1 },
        });
      }

      return tx.sequenceStep.findMany({
        where: { sequenceId: sequence.id, isArchived: false },
        orderBy: { stepOrder: 'asc' },
        include: { variants: true },
      });
    });
  }

  /**
   * Delete or archive a step from a sequence with historical accuracy preservation
   */
  async deleteStep(stepId: string) {
    const step = await this.prisma.sequenceStep.findUnique({
      where: { id: stepId },
      include: {
        _count: { select: { emailLogs: true } },
      },
    });
    if (!step) {
      throw new NotFoundException('Sequence step not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (step._count.emailLogs > 0) {
        // Soft delete/archive to preserve historical email logs and stats
        await tx.sequenceStep.update({
          where: { id: stepId },
          data: {
            isArchived: true,
            status: 'ARCHIVED',
            deletedAt: new Date(),
          },
        });
      } else {
        // Has never dispatched any emails: safe to hard delete
        await tx.sequenceVariant.deleteMany({ where: { sequenceStepId: stepId } });
        await tx.sequenceStep.delete({ where: { id: stepId } });
      }

      // Re-index remaining active steps so stepOrder remains contiguous (1, 2, 3...)
      const remainingSteps = await tx.sequenceStep.findMany({
        where: { sequenceId: step.sequenceId, isArchived: false },
        orderBy: { stepOrder: 'asc' },
      });

      for (let i = 0; i < remainingSteps.length; i++) {
        await tx.sequenceStep.update({
          where: { id: remainingSteps[i].id },
          data: { stepOrder: -(i + 1) },
        });
      }

      for (let i = 0; i < remainingSteps.length; i++) {
        await tx.sequenceStep.update({
          where: { id: remainingSteps[i].id },
          data: { stepOrder: i + 1 },
        });
      }

      return { success: true, message: 'Step removed successfully' };
    });
  }

  /**
   * Select a variant based on weighted random distribution for A/B testing
   */
  selectWeightedVariant(variants: any[]) {
    if (!variants || variants.length === 0) return null;
    if (variants.length === 1) return variants[0];

    const random = Math.random() * 100;
    let accumulated = 0;

    for (const variant of variants) {
      accumulated += variant.weight;
      if (random <= accumulated) {
        return variant;
      }
    }

    return variants[0];
  }
}

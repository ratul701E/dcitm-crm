import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStepDto, UpdateStepDto } from './dto/sequence.dto';

@Injectable()
export class SequencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves sequence definition and all steps for a campaign
   */
  async getSequenceByCampaign(campaignId: string) {
    const sequence = await this.prisma.sequence.findFirst({
      where: { campaignId },
      include: {
        steps: {
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
   * Add an ordered step with A/B variants to a sequence
   */
  async addStep(campaignId: string, dto: CreateStepDto) {
    const sequence = await this.getSequenceByCampaign(campaignId);

    // Validate that variants total weight is 100%
    if (!dto.variants || dto.variants.length === 0) {
      throw new BadRequestException('At least one email variant is required for a sequence step');
    }
    const totalWeight = dto.variants.reduce((acc, v) => acc + v.weight, 0);
    if (totalWeight !== 100) {
      throw new BadRequestException(
        `Total weight of step variants must equal 100% (currently ${totalWeight}%)`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const step = await tx.sequenceStep.create({
        data: {
          sequenceId: sequence.id,
          stepOrder: dto.stepOrder,
          delayDays: dto.delayDays !== undefined ? dto.delayDays : 3,
          delayHours: dto.delayHours !== undefined ? dto.delayHours : 0,
        },
      });

      await tx.sequenceVariant.createMany({
        data: dto.variants.map((v) => ({
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
   * Update step delays or copy variants
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
      if (dto.variants && dto.variants.length > 0) {
        const totalWeight = dto.variants.reduce((acc, v) => acc + v.weight, 0);
        if (totalWeight !== 100) {
          throw new BadRequestException(
            `Total weight of step variants must equal 100% (currently ${totalWeight}%)`,
          );
        }

        // Replace variants
        await tx.sequenceVariant.deleteMany({ where: { sequenceStepId: stepId } });
        await tx.sequenceVariant.createMany({
          data: dto.variants.map((v) => ({
            sequenceStepId: stepId,
            variantKey: v.variantKey,
            weight: v.weight,
            subject: v.subject,
            body: v.body,
          })),
        });
      }

      return tx.sequenceStep.update({
        where: { id: stepId },
        data: {
          delayDays: dto.delayDays,
          delayHours: dto.delayHours,
        },
        include: { variants: true },
      });
    });
  }

  /**
   * Delete a step from a sequence
   */
  async deleteStep(stepId: string) {
    const step = await this.prisma.sequenceStep.findUnique({
      where: { id: stepId },
    });
    if (!step) {
      throw new NotFoundException('Sequence step not found');
    }
    return this.prisma.sequenceStep.delete({ where: { id: stepId } });
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

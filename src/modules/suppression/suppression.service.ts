import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UnsubscribeService } from './unsubscribe.service';
import { CreateSuppressionDto, BulkSuppressionDto } from './dto/suppression.dto';
import { SuppressionReason, LeadStatus } from '@prisma/client';

@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unsubscribeService: UnsubscribeService,
  ) {}

  /**
   * Adds an email or wildcard domain to suppression
   */
  async addSuppression(dto: CreateSuppressionDto) {
    const rawVal = dto.value.trim().toLowerCase();
    const isWildcard = rawVal.startsWith('@');
    const cleanValue = isWildcard ? rawVal : rawVal;

    const existing = await this.prisma.suppressionEntry.findUnique({
      where: { value: cleanValue },
    });
    if (existing) {
      return existing;
    }

    const entry = await this.prisma.suppressionEntry.create({
      data: {
        value: cleanValue,
        isWildcard,
        reason: dto.reason,
        source: dto.source || 'manual',
        notes: dto.notes || null,
      },
    });

    // Automatically update existing matching leads to SUPPRESSED status
    if (isWildcard) {
      const domainSuffix = cleanValue.replace('@', '');
      await this.prisma.lead.updateMany({
        where: {
          email: { endsWith: `@${domainSuffix}` },
        },
        data: { status: LeadStatus.SUPPRESSED },
      });
    } else {
      await this.prisma.lead.updateMany({
        where: { email: cleanValue },
        data: { status: LeadStatus.SUPPRESSED },
      });
    }

    return entry;
  }

  /**
   * Bulk suppression entry
   */
  async addBulkSuppression(dto: BulkSuppressionDto) {
    let addedCount = 0;
    for (const val of dto.values) {
      if (!val || val.trim().length === 0) continue;
      try {
        await this.addSuppression({
          value: val,
          reason: dto.reason,
          source: 'bulk_import',
        });
        addedCount++;
      } catch (err: any) {
        this.logger.warn(`Skipping duplicate or invalid suppression: ${val}`);
      }
    }
    return { success: true, count: addedCount };
  }

  /**
   * Checks whether a given email is suppressed (via exact match or wildcard domain)
   */
  async isSuppressed(email: string): Promise<{ suppressed: boolean; reason?: SuppressionReason }> {
    const cleanEmail = email.trim().toLowerCase();
    const parts = cleanEmail.split('@');
    if (parts.length !== 2) {
      return { suppressed: true, reason: SuppressionReason.INVALID_EMAIL };
    }

    const domainWildcard = `@${parts[1]}`;

    // Query both exact email and domain wildcard
    const match = await this.prisma.suppressionEntry.findFirst({
      where: {
        OR: [
          { value: cleanEmail },
          { value: domainWildcard, isWildcard: true },
        ],
      },
    });

    if (match) {
      return { suppressed: true, reason: match.reason };
    }
    return { suppressed: false };
  }

  /**
   * Handle prospect unsubscribe request with signed HMAC token
   */
  async handleUnsubscribe(token: string) {
    const verified = this.unsubscribeService.verifyUnsubscribeToken(token);
    if (!verified) {
      return { success: false, message: 'Invalid or expired unsubscribe signature' };
    }

    await this.addSuppression({
      value: verified.email,
      reason: SuppressionReason.UNSUBSCRIBE,
      source: 'unsubscribe_link',
    });

    return {
      success: true,
      message: `You have been unsubscribed from all future communications.`,
      email: verified.email,
    };
  }

  async findAll(page = 1, limit = 50, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.value = { contains: search.toLowerCase() };
    }

    const [items, total] = await Promise.all([
      this.prisma.suppressionEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.suppressionEntry.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async remove(id: string) {
    const existing = await this.prisma.suppressionEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Suppression entry not found');
    }
    return this.prisma.suppressionEntry.delete({ where: { id } });
  }
}

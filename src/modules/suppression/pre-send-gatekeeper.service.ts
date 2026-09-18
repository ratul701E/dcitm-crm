import { Injectable, Logger } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus } from '@prisma/client';

export interface GatekeeperCheckResult {
  allowed: boolean;
  dropReason?: string;
}

@Injectable()
export class PreSendGatekeeperService {
  private readonly logger = new Logger(PreSendGatekeeperService.name);

  constructor(
    private readonly suppressionService: SuppressionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Pre-send gatekeeper: intercept email dispatch to guarantee suppression compliance
   */
  async validateRecipient(email: string, leadId?: string): Promise<GatekeeperCheckResult> {
    const check = await this.suppressionService.isSuppressed(email);

    if (check.suppressed) {
      this.logger.warn(
        `Pre-send gatekeeper BLOCKED dispatch to ${email} (Reason: ${check.reason})`,
      );

      // Auto-update lead status to SUPPRESSED
      if (leadId) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { status: LeadStatus.SUPPRESSED },
        });
      }

      return {
        allowed: false,
        dropReason: `Recipient is suppressed: ${check.reason}`,
      };
    }

    return { allowed: true };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CampaignStatus, EmailDispatchStatus } from '@prisma/client';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Monitor rolling 24-hour bounce rate every 15 minutes
   */
  @Cron('*/15 * * * *')
  async monitorBounceRates() {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.ACTIVE },
    });

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const campaign of activeCampaigns) {
      // Fetch 24-hour dispatches for campaign
      const totalSent = await this.prisma.emailLog.count({
        where: {
          campaignId: campaign.id,
          sentAt: { gte: twentyFourHoursAgo },
        },
      });

      // Avoid false triggers on tiny volumes (min threshold: 20 sends)
      if (totalSent < 20) continue;

      const totalBounced = await this.prisma.emailLog.count({
        where: {
          campaignId: campaign.id,
          status: EmailDispatchStatus.BOUNCED,
          createdAt: { gte: twentyFourHoursAgo },
        },
      });

      const bounceRate = (totalBounced / totalSent) * 100;

      // 3% threshold circuit breaker
      if (bounceRate > 3.0) {
        this.logger.error(
          `🚨 CIRCUIT BREAKER TRIGGERED: Campaign "${campaign.title}" (${campaign.id}) has a 24h bounce rate of ${bounceRate.toFixed(2)}% (Threshold: 3%). Auto-pausing immediately!`,
        );

        // Auto-pause campaign to save domain reputation
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: CampaignStatus.PAUSED },
        });

        // Record audit trail
        await this.auditService.log({
          action: 'CIRCUIT_BREAKER_PAUSE',
          targetEntity: 'Campaign',
          targetId: campaign.id,
          metadata: {
            reason: `Bounce rate exceeded 3% (Current: ${bounceRate.toFixed(2)}%, Bounces: ${totalBounced}, Sent: ${totalSent})`,
            campaignTitle: campaign.title,
          },
        });
      }
    }
  }
}

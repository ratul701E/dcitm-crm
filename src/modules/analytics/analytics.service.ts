import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const [totalSent, totalDelivered, totalOpened, totalClicked, totalBounced] =
      await Promise.all([
        this.prisma.emailLog.count({
          where: { createdAt: { gte: cutoff }, status: { in: ['SENT', 'DELIVERED'] } },
        }),
        this.prisma.emailLog.count({
          where: { createdAt: { gte: cutoff }, status: 'DELIVERED' },
        }),
        this.prisma.emailLog.count({
          where: { createdAt: { gte: cutoff }, openCount: { gt: 0 } },
        }),
        this.prisma.emailLog.count({
          where: { createdAt: { gte: cutoff }, clickCount: { gt: 0 } },
        }),
        this.prisma.emailLog.count({
          where: { createdAt: { gte: cutoff }, status: 'BOUNCED' },
        }),
      ]);

    const totalReplies = await this.prisma.inboundReply.count({
      where: { createdAt: { gte: cutoff } },
    });

    const openRate = totalSent > 0 ? Number(((totalOpened / totalSent) * 100).toFixed(1)) : 0;
    const clickRate = totalSent > 0 ? Number(((totalClicked / totalSent) * 100).toFixed(1)) : 0;
    const replyRate = totalSent > 0 ? Number(((totalReplies / totalSent) * 100).toFixed(1)) : 0;
    const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(1)) : 0;

    return {
      sent: totalSent,
      delivered: totalDelivered,
      opened: totalOpened,
      clicked: totalClicked,
      replied: totalReplies,
      bounced: totalBounced,
      openRate,
      clickRate,
      replyRate,
      bounceRate,
    };
  }

  async getTimeline(days = 14) {
    const rollups = await this.prisma.analyticsRollup.findMany({
      orderBy: { date: 'asc' },
      take: days,
    });

    if (rollups.length > 0) {
      return rollups.map((r) => {
        const sent = r.sentCount;
        const delivered = r.deliveredCount;
        const deliveryRate = sent > 0 ? Number(((delivered / sent) * 100).toFixed(1)) : 100;
        return {
          date: r.date.toISOString().split('T')[0],
          sent,
          dispatched: sent,
          delivered,
          deliveryRate,
          opened: r.openCount,
          clicked: r.clickCount,
          replied: r.replyCount,
          bounced: r.bounceCount,
        };
      });
    }

    // Dynamic aggregation from EmailLog if rollups are not populated
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);

    const logs = await this.prisma.emailLog.findMany({
      where: {
        createdAt: { gte: cutoff },
      },
      select: {
        createdAt: true,
        sentAt: true,
        status: true,
        openCount: true,
        clickCount: true,
      },
    });

    const dayMap = new Map<
      string,
      { sent: number; delivered: number; bounced: number; opened: number; clicked: number }
    >();

    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dayMap.set(dateStr, { sent: 0, delivered: 0, bounced: 0, opened: 0, clicked: 0 });
    }

    for (const log of logs) {
      const targetDate = (log.sentAt || log.createdAt).toISOString().split('T')[0];
      const entry = dayMap.get(targetDate);
      if (entry) {
        if (log.status === 'SENT' || log.status === 'DELIVERED') {
          entry.sent++;
          entry.delivered++;
        } else if (log.status === 'BOUNCED') {
          entry.sent++;
          entry.bounced++;
        }
        if (log.openCount > 0) entry.opened++;
        if (log.clickCount > 0) entry.clicked++;
      }
    }

    const result = [];
    for (const [dateStr, data] of dayMap.entries()) {
      const deliveredCount = Math.max(0, data.sent - data.bounced);
      const deliveryRate = data.sent > 0
        ? Number(((deliveredCount / data.sent) * 100).toFixed(1))
        : 100;

      result.push({
        date: dateStr,
        sent: data.sent,
        dispatched: data.sent,
        delivered: deliveredCount,
        deliveryRate,
        opened: data.opened,
        clicked: data.clicked,
        replied: 0,
        bounced: data.bounced,
      });
    }

    return result;
  }

  async getByCampaign() {
    const campaigns = await this.prisma.campaign.findMany({
      select: {
        id: true,
        title: true,
        status: true,
        _count: {
          select: { emailLogs: true },
        },
      },
      take: 20,
    });

    return Promise.all(
      campaigns.map(async (c) => {
        const [sent, opened, clicked, bounced] = await Promise.all([
          this.prisma.emailLog.count({ where: { campaignId: c.id, status: { in: ['SENT', 'DELIVERED'] } } }),
          this.prisma.emailLog.count({ where: { campaignId: c.id, openCount: { gt: 0 } } }),
          this.prisma.emailLog.count({ where: { campaignId: c.id, clickCount: { gt: 0 } } }),
          this.prisma.emailLog.count({ where: { campaignId: c.id, status: 'BOUNCED' } }),
        ]);

        const replied = await this.prisma.inboundReply.count({
          where: { emailLog: { campaignId: c.id } },
        });

        return {
          id: c.id,
          title: c.title,
          status: c.status,
          sent,
          opened,
          clicked,
          replied,
          bounced,
          openRate: sent > 0 ? Number(((opened / sent) * 100).toFixed(1)) : 0,
          clickRate: sent > 0 ? Number(((clicked / sent) * 100).toFixed(1)) : 0,
          replyRate: sent > 0 ? Number(((replied / sent) * 100).toFixed(1)) : 0,
        };
      }),
    );
  }

  async getByProvider() {
    const mailboxes = await this.prisma.mailbox.findMany({
      select: {
        id: true,
        type: true,
        email: true,
        sentCountToday: true,
        dailySendingLimit: true,
      },
    });

    const providerMap: Record<string, { provider: string; count: number; sentToday: number }> = {};
    for (const m of mailboxes) {
      if (!providerMap[m.type]) {
        providerMap[m.type] = { provider: m.type, count: 0, sentToday: 0 };
      }
      providerMap[m.type].count++;
      providerMap[m.type].sentToday += m.sentCountToday;
    }

    return Object.values(providerMap);
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      activeCampaigns,
      totalCampaigns,
      mailboxes,
      totalLeads,
      sentLogs,
      openLogs,
      clickLogs,
      replies,
      recentActivity,
    ] = await Promise.all([
      this.prisma.campaign.count({ where: { status: 'ACTIVE' } }),
      this.prisma.campaign.count(),
      this.prisma.mailbox.findMany({
        select: {
          id: true,
          state: true,
          sentCountToday: true,
          dailySendingLimit: true,
        },
      }),
      this.prisma.lead.count(),
      this.prisma.emailLog.count({
        where: { status: { in: ['SENT', 'DELIVERED'] } },
      }),
      this.prisma.emailLog.count({
        where: { openCount: { gt: 0 } },
      }),
      this.prisma.emailLog.count({
        where: { clickCount: { gt: 0 } },
      }),
      this.prisma.inboundReply.count(),
      this.prisma.auditLog.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    const totalMailboxes = mailboxes.length;
    const activeMailboxes = mailboxes.filter(
      (m) => m.state === 'ACTIVE' || m.state === 'WARMING',
    ).length;
    const todaySentCount = mailboxes.reduce((acc, m) => acc + m.sentCountToday, 0);
    const dailyLimitTotal = mailboxes.reduce((acc, m) => acc + m.dailySendingLimit, 0);

    const openRate = sentLogs > 0 ? Number(((openLogs / sentLogs) * 100).toFixed(1)) : 0;
    const clickRate = sentLogs > 0 ? Number(((clickLogs / sentLogs) * 100).toFixed(1)) : 0;
    const replyRate = sentLogs > 0 ? Number(((replies / sentLogs) * 100).toFixed(1)) : 0;

    return {
      activeCampaigns,
      totalCampaigns,
      totalMailboxes,
      activeMailboxes,
      totalLeads,
      todaySentCount,
      dailyLimitTotal,
      openRate,
      clickRate,
      replyRate,
      totalSent: sentLogs,
      recentActivity,
    };
  }
}

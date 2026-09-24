import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAuditLogParams {
  actorUserId?: string;
  action: string;
  targetEntity: string;
  targetId?: string;
  metadata?: any;
  ipAddress?: string;
  status?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: CreateAuditLogParams) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.action,
        targetEntity: params.targetEntity,
        targetId: params.targetId,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
        status: params.status || 'success',
      },
    });
  }

  async getLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

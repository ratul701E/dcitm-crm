import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProviderAdaptersService } from '../dispatcher/provider-adapters.service';
import { SuppressionService } from '../suppression/suppression.service';
import { UpdateReplyCategoryDto, SendManualReplyDto } from './dto/unibox.dto';
import { ReplyCategory, SuppressionReason } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class UniboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailboxesService: MailboxesService,
    private readonly adapters: ProviderAdaptersService,
    private readonly suppressionService: SuppressionService,
  ) {}

  /**
   * List paginated inbound replies across all mailboxes with filtering
   */
  async getReplies(page = 1, limit = 50, category?: ReplyCategory, mailboxId?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (category) {
      where.category = category;
    }
    if (mailboxId) {
      where.mailboxId = mailboxId;
    }

    const [items, total] = await Promise.all([
      this.prisma.inboundReply.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedAt: 'desc' },
        include: {
          mailbox: {
            select: { id: true, email: true },
          },
          lead: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
            },
          },
          emailLog: {
            select: {
              id: true,
              messageId: true,
              campaign: { select: { id: true, title: true } },
            },
          },
        },
      }),
      this.prisma.inboundReply.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single reply thread history
   */
  async getReplyThread(replyId: string) {
    const reply = await this.prisma.inboundReply.findUnique({
      where: { id: replyId },
      include: {
        mailbox: true,
        lead: true,
        emailLog: {
          include: {
            campaign: true,
            sequenceStep: true,
            sequenceVariant: true,
          },
        },
      },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    // Fetch prior outbound logs for this lead
    const history = await this.prisma.emailLog.findMany({
      where: { leadId: reply.leadId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      reply,
      history,
    };
  }

  /**
   * Update category label (e.g. mark as Interested or Unsubscribe)
   */
  async updateCategory(replyId: string, dto: UpdateReplyCategoryDto) {
    const reply = await this.prisma.inboundReply.findUnique({
      where: { id: replyId },
      include: { lead: true },
    });
    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    const updated = await this.prisma.inboundReply.update({
      where: { id: replyId },
      data: { category: dto.category },
    });

    // Auto-quarantine to suppression if marked as UNSUBSCRIBE
    if (dto.category === ReplyCategory.UNSUBSCRIBE && reply.lead?.email) {
      await this.suppressionService.addSuppression({
        value: reply.lead.email,
        reason: SuppressionReason.UNSUBSCRIBE,
        source: 'unibox_manual_label',
      });
    }

    return updated;
  }

  /**
   * Send manual response from Unibox keeping RFC threading intact
   */
  async sendManualReply(replyId: string, dto: SendManualReplyDto) {
    const reply = await this.prisma.inboundReply.findUnique({
      where: { id: replyId },
      include: {
        mailbox: true,
        lead: true,
        emailLog: true,
      },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    const decryptedConfig = await this.mailboxesService.getDecryptedConfig(reply.mailboxId);

    // Formulate thread Message-ID & inReplyTo
    const domainHost = reply.mailbox.email.split('@')[1] || 'outreach.internal';
    const messageId = `${Date.now()}.${crypto.randomBytes(16).toString('hex')}@${domainHost}`;
    const inReplyTo = reply.emailLog?.messageId || undefined;
    const subject = dto.subject || `Re: ${reply.subject.replace(/^Re:\s*/i, '')}`;

    await this.adapters.dispatch(reply.mailbox.type, decryptedConfig, {
      to: reply.fromEmail,
      from: reply.mailbox.email,
      subject,
      html: dto.htmlBody,
      messageId,
      inReplyTo,
      references: inReplyTo,
    });

    return {
      success: true,
      message: `Manual response sent to ${reply.fromEmail}`,
      messageId,
    };
  }
}

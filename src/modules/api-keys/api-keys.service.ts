import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProviderAdaptersService } from '../dispatcher/provider-adapters.service';
import { AuditService } from '../audit/audit.service';
import { CreateApiKeyDto, UpdateApiKeyDto, SendEmailDto } from './dto/api-key.dto';
import { EmailDispatchStatus, MailboxState } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailboxesService: MailboxesService,
    private readonly adapters: ProviderAdaptersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a new API Key with SHA-256 hash and binds it to a Mailbox
   */
  async create(dto: CreateApiKeyDto, actorUserId?: string) {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id: dto.mailboxId },
    });

    if (!mailbox) {
      throw new NotFoundException(`Mailbox ${dto.mailboxId} not found`);
    }

    if (mailbox.state === MailboxState.AUTH_FAILED) {
      throw new BadRequestException(
        `Mailbox ${mailbox.email} is currently in AUTH_FAILED state. Re-authenticate before generating API keys.`,
      );
    }

    // Generate high-entropy API key with readable prefix
    const randomBytes = crypto.randomBytes(24).toString('hex');
    const rawKey = `crm_live_${randomBytes}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = `crm_live_...${rawKey.slice(-4)}`;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: dto.name.trim(),
        keyHash,
        keyPrefix,
        mailboxId: dto.mailboxId,
        createdById: actorUserId || null,
        rateLimitPerHour: dto.rateLimitPerHour ?? 100,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        mailbox: {
          select: {
            id: true,
            email: true,
            type: true,
            state: true,
            displayName: true,
            senderName: true,
          },
        },
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'API_KEY_CREATED',
      targetEntity: 'ApiKey',
      targetId: apiKey.id,
      metadata: {
        name: apiKey.name,
        mailboxEmail: mailbox.email,
        keyPrefix,
      },
    });

    // Return the raw key ONCE so the admin can copy it
    return {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey,
      keyPrefix: apiKey.keyPrefix,
      mailboxId: apiKey.mailboxId,
      mailbox: apiKey.mailbox,
      rateLimitPerHour: apiKey.rateLimitPerHour,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Retrieves all API Keys with associated mailbox info (never exposing secret hash)
   */
  async findAll() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        mailboxId: true,
        isActive: true,
        rateLimitPerHour: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        mailbox: {
          select: {
            id: true,
            email: true,
            type: true,
            state: true,
            displayName: true,
            senderName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves a single API Key by ID
   */
  async findOne(id: string) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        mailboxId: true,
        isActive: true,
        rateLimitPerHour: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        mailbox: {
          select: {
            id: true,
            email: true,
            type: true,
            state: true,
            displayName: true,
            senderName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!key) {
      throw new NotFoundException(`API Key ${id} not found`);
    }

    return key;
  }

  /**
   * Toggles or updates active state of an API Key
   */
  async toggleActive(id: string, actorUserId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      throw new NotFoundException(`API Key ${id} not found`);
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: !key.isActive },
      include: {
        mailbox: {
          select: { id: true, email: true },
        },
      },
    });

    await this.auditService.log({
      actorUserId,
      action: updated.isActive ? 'API_KEY_ACTIVATED' : 'API_KEY_DEACTIVATED',
      targetEntity: 'ApiKey',
      targetId: id,
      metadata: { name: key.name, keyPrefix: key.keyPrefix },
    });

    return updated;
  }

  /**
   * Updates an API key
   */
  async update(id: string, dto: UpdateApiKeyDto, actorUserId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      throw new NotFoundException(`API Key ${id} not found`);
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        rateLimitPerHour: dto.rateLimitPerHour !== undefined ? dto.rateLimitPerHour : undefined,
        expiresAt: dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt) : null) : undefined,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'API_KEY_UPDATED',
      targetEntity: 'ApiKey',
      targetId: id,
      metadata: { dto },
    });

    return updated;
  }

  /**
   * Permanently deletes / revokes an API Key
   */
  async remove(id: string, actorUserId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      throw new NotFoundException(`API Key ${id} not found`);
    }

    await this.prisma.apiKey.delete({ where: { id } });

    await this.auditService.log({
      actorUserId,
      action: 'API_KEY_DELETED',
      targetEntity: 'ApiKey',
      targetId: id,
      metadata: { name: key.name, keyPrefix: key.keyPrefix },
    });

    return { success: true, message: `API Key ${key.name} successfully deleted` };
  }

  /**
   * Dispatches an outbound email using the API Key's bound Mailbox
   */
  async sendEmail(mailbox: any, apiKey: any, dto: SendEmailDto) {
    // 1. Quota check: Mailbox daily limits
    if (mailbox.sentCountToday >= mailbox.dailySendingLimit) {
      throw new HttpException(
        `Daily sending limit reached for mailbox ${mailbox.email} (${mailbox.sentCountToday}/${mailbox.dailySendingLimit})`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Rate limit check for API key (emails sent in the last 60 minutes)
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const sentThisHour = await this.prisma.transactionalEmailLog.count({
      where: {
        apiKeyId: apiKey.id,
        sentAt: { gte: oneHourAgo },
        status: EmailDispatchStatus.SENT,
      },
    });

    if (sentThisHour >= (apiKey.rateLimitPerHour || 100)) {
      throw new HttpException(
        `Hourly rate limit reached for this API key (${sentThisHour}/${apiKey.rateLimitPerHour})`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3. Format sender From address
    const senderDisplayName =
      (dto.fromName && dto.fromName.trim()) ||
      (mailbox.senderName && mailbox.senderName.trim()) ||
      (mailbox.displayName && mailbox.displayName.trim()) ||
      '';
    const fromAddress = senderDisplayName
      ? `"${senderDisplayName.replace(/"/g, '')}" <${mailbox.email.trim()}>`
      : mailbox.email.trim();

    // 4. Format recipient(s)
    const toRecipient = Array.isArray(dto.to) ? dto.to.join(', ') : dto.to;

    // 5. Generate RFC 2822 Message-ID
    const uniqueHash = crypto.randomBytes(16).toString('hex');
    const domainHost = mailbox.email.split('@')[1] || 'outbound.internal';
    const messageId = `${Date.now()}.${uniqueHash}@${domainHost}`;

    // 6. Body content preparation
    const htmlBody = dto.html || (dto.text ? `<p style="white-space: pre-wrap;">${dto.text}</p>` : '');
    const textBody = dto.text || (dto.html ? dto.html.replace(/<[^>]*>/g, '') : '');

    // 7. Decrypt Mailbox Configuration
    const decryptedConfig = await this.mailboxesService.getDecryptedConfig(mailbox.id);

    // 8. Dispatch Email via Provider Adapter
    let dispatchResult;
    try {
      dispatchResult = await this.adapters.dispatch(mailbox.type, decryptedConfig, {
        to: toRecipient,
        from: fromAddress,
        subject: dto.subject,
        html: htmlBody,
        text: textBody,
        messageId,
        replyTo: dto.replyTo || mailbox.replyToEmail || undefined,
        cc: dto.cc,
        bcc: dto.bcc,
      });
    } catch (err: any) {
      await this.prisma.transactionalEmailLog.create({
        data: {
          apiKeyId: apiKey.id,
          mailboxId: mailbox.id,
          messageId,
          to: toRecipient,
          subject: dto.subject,
          status: EmailDispatchStatus.FAILED,
          error: err.message,
        },
      });

      throw new BadGatewayException(
        `Failed to dispatch email via ${mailbox.type} provider: ${err.message}`,
      );
    }

    if (!dispatchResult?.success) {
      const errorMsg = dispatchResult?.error || 'Provider rejected email dispatch';
      await this.prisma.transactionalEmailLog.create({
        data: {
          apiKeyId: apiKey.id,
          mailboxId: mailbox.id,
          messageId,
          to: toRecipient,
          subject: dto.subject,
          status: EmailDispatchStatus.FAILED,
          error: errorMsg,
        },
      });
      throw new BadGatewayException(errorMsg);
    }

    // 9. Record successful dispatch
    const log = await this.prisma.transactionalEmailLog.create({
      data: {
        apiKeyId: apiKey.id,
        mailboxId: mailbox.id,
        messageId,
        to: toRecipient,
        subject: dto.subject,
        status: EmailDispatchStatus.SENT,
      },
    });

    // 10. Increment mailbox counters
    await this.prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        sentCountToday: { increment: 1 },
        sentThisHour: { increment: 1 },
        lastSentAt: new Date(),
      },
    });

    return {
      success: true,
      messageId,
      logId: log.id,
      to: toRecipient,
      from: fromAddress,
      sentAt: log.sentAt,
    };
  }

  /**
   * Retrieves transactional dispatch logs (with optional filtering by apiKeyId)
   */
  async getLogs(apiKeyId?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where = apiKeyId ? { apiKeyId } : {};

    const [items, total] = await Promise.all([
      this.prisma.transactionalEmailLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
        include: {
          apiKey: {
            select: { id: true, name: true, keyPrefix: true },
          },
          mailbox: {
            select: { id: true, email: true },
          },
        },
      }),
      this.prisma.transactionalEmailLog.count({ where }),
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


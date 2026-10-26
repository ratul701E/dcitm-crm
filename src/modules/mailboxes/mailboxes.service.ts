import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../common/vault/vault.service';
import { SmtpValidatorService } from './smtp-validator.service';
import { AuditService } from '../audit/audit.service';
import { CreateMailboxDto, UpdateMailboxDto } from './dto/mailbox.dto';
import { MailboxState, MailboxType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class MailboxesService {
  private readonly logger = new Logger(MailboxesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly smtpValidator: SmtpValidatorService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateMailboxDto) {
    const email = dto.email.toLowerCase().trim();

    // Resolve or auto-provision domain
    const domainPart = email.split('@')[1]?.toLowerCase().trim();
    let domain: any = null;

    if (dto.domainId) {
      domain = await this.prisma.domain.findUnique({
        where: { id: dto.domainId },
      });
    }

    if (!domain && domainPart) {
      domain = await this.prisma.domain.findUnique({
        where: { name: domainPart },
      });
      if (!domain) {
        domain = await this.prisma.domain.create({
          data: {
            name: domainPart,
            dkimSelector: 'google',
          },
        });
        this.logger.log(`Auto-created domain ${domainPart} (${domain.id}) for mailbox ${email}`);
      }
    }

    if (!domain) {
      throw new BadRequestException('Could not determine or create a valid domain for this mailbox');
    }

    const domainId = domain.id;

    const existing = await this.prisma.mailbox.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(`Mailbox ${email} is already registered`);
    }

    let rawConfigToEncrypt: any = null;

    if (dto.type === MailboxType.SMTP_IMAP) {
      if (!dto.smtpImapConfig) {
        throw new BadRequestException('SMTP and IMAP configurations are required');
      }
      // Validate SMTP connection with STARTTLS
      await this.smtpValidator.verifySmtp(dto.smtpImapConfig);
      // Validate IMAP connection
      if (dto.smtpImapConfig.imapHost) {
        await this.smtpValidator.verifyImap(dto.smtpImapConfig);
      }
      rawConfigToEncrypt = dto.smtpImapConfig;
    } else if (dto.type === MailboxType.GOOGLE || dto.type === MailboxType.MICROSOFT) {
      if (!dto.oauthConfig) {
        throw new BadRequestException('OAuth configuration payload is required');
      }
      rawConfigToEncrypt = dto.oauthConfig;
    }

    // Encrypt configuration through AES-256-GCM Vault
    const encryptedConfig = this.vault.encrypt(rawConfigToEncrypt);

    const mailbox = await this.prisma.mailbox.create({
      data: {
        email,
        domainId,
        type: dto.type,
        state: MailboxState.WARMING,
        encryptedConfig: encryptedConfig as any,
        dailySendingLimit: dto.dailySendingLimit || 50,
        warmupDailyLimit: dto.warmupDailyLimit || 10,
        hourlyLimit: dto.hourlyLimit || 10,
        minDelaySeconds: dto.minDelaySeconds ?? 0,
        displayName: dto.displayName,
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail || null,
      },
      select: {
        id: true,
        email: true,
        domainId: true,
        type: true,
        state: true,
        displayName: true,
        senderName: true,
        replyToEmail: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        hourlyLimit: true,
        sentCountToday: true,
        sentThisHour: true,
        minDelaySeconds: true,
        lastSentAt: true,
        lastSyncAt: true,
        createdAt: true,
      },
    });

    await this.auditService.log({
      action: 'MAILBOX_CREATE',
      targetEntity: 'Mailbox',
      targetId: mailbox.id,
      metadata: { email: mailbox.email, type: mailbox.type },
      status: 'success',
    });

    return mailbox;
  }

  async findAll() {
    const mailboxes = await this.prisma.mailbox.findMany({
      include: {
        domain: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return mailboxes.map((m) => {
      let safeConfig: any = {};
      if (m.type === MailboxType.SMTP_IMAP && m.encryptedConfig) {
        try {
          const decrypted = this.vault.decrypt(m.encryptedConfig as any, true);
          safeConfig = {
            smtpHost: decrypted?.smtpHost,
            smtpPort: decrypted?.smtpPort,
            smtpSecurity: decrypted?.smtpSecurity ?? (decrypted?.smtpPort === 465 ? 'ssl' : 'tls'),
            smtpUsername: decrypted?.smtpUser,
            imapHost: decrypted?.imapHost,
            imapPort: decrypted?.imapPort,
            imapSecurity: decrypted?.imapSecurity ?? (decrypted?.imapPort === 993 ? 'ssl' : 'tls'),
            imapUsername: decrypted?.imapUser,
          };
        } catch {
          // ignore corrupted legacy config
        }
      }

      return {
        id: m.id,
        email: m.email,
        domainId: m.domainId,
        domain: m.domain,
        type: m.type,
        state: m.state,
        displayName: m.displayName,
        senderName: m.senderName,
        replyToEmail: m.replyToEmail,
        dailySendingLimit: m.dailySendingLimit,
        warmupDailyLimit: m.warmupDailyLimit,
        hourlyLimit: m.hourlyLimit,
        sentCountToday: m.sentCountToday,
        sentThisHour: m.sentThisHour,
        minDelaySeconds: m.minDelaySeconds,
        lastSentAt: m.lastSentAt,
        lastSyncAt: m.lastSyncAt,
        createdAt: m.createdAt,
        ...safeConfig,
      };
    });
  }

  async findOne(id: string) {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id },
      include: {
        domain: { select: { name: true, dkimSelector: true } },
      },
    });
    if (!mailbox) {
      throw new NotFoundException('Mailbox not found');
    }

    let safeConfig: any = {};
    if (mailbox.type === MailboxType.SMTP_IMAP && mailbox.encryptedConfig) {
      try {
        const decrypted = this.vault.decrypt(mailbox.encryptedConfig as any, true);
        safeConfig = {
          smtpHost: decrypted?.smtpHost,
          smtpPort: decrypted?.smtpPort,
          smtpSecurity: decrypted?.smtpSecurity ?? (decrypted?.smtpPort === 465 ? 'ssl' : 'tls'),
          smtpUsername: decrypted?.smtpUser,
          imapHost: decrypted?.imapHost,
          imapPort: decrypted?.imapPort,
          imapSecurity: decrypted?.imapSecurity ?? (decrypted?.imapPort === 993 ? 'ssl' : 'tls'),
          imapUsername: decrypted?.imapUser,
        };
      } catch {
        // ignore decryption error
      }
    }

    return {
      id: mailbox.id,
      email: mailbox.email,
      domainId: mailbox.domainId,
      domain: mailbox.domain,
      type: mailbox.type,
      state: mailbox.state,
      displayName: mailbox.displayName,
      senderName: mailbox.senderName,
      replyToEmail: mailbox.replyToEmail,
      dailySendingLimit: mailbox.dailySendingLimit,
      warmupDailyLimit: mailbox.warmupDailyLimit,
      hourlyLimit: mailbox.hourlyLimit,
      sentCountToday: mailbox.sentCountToday,
      sentThisHour: mailbox.sentThisHour,
      minDelaySeconds: mailbox.minDelaySeconds,
      lastSentAt: mailbox.lastSentAt,
      lastSyncAt: mailbox.lastSyncAt,
      createdAt: mailbox.createdAt,
      ...safeConfig,
    };
  }

  async getSafeConnectionConfig(id: string) {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id },
      select: { type: true, encryptedConfig: true },
    });
    if (!mailbox) {
      throw new NotFoundException('Mailbox not found');
    }
    if (mailbox.type !== MailboxType.SMTP_IMAP) {
      return {};
    }
    const decrypted = this.vault.decrypt(mailbox.encryptedConfig as any, true);
    return {
      smtpHost: decrypted?.smtpHost,
      smtpPort: decrypted?.smtpPort,
      smtpSecurity: decrypted?.smtpSecurity ?? (decrypted?.smtpPort === 465 ? 'ssl' : 'tls'),
      smtpUsername: decrypted?.smtpUser,
      imapHost: decrypted?.imapHost,
      imapPort: decrypted?.imapPort,
      imapSecurity: decrypted?.imapSecurity ?? (decrypted?.imapPort === 993 ? 'ssl' : 'tls'),
      imapUsername: decrypted?.imapUser,
    };
  }

  async update(id: string, dto: UpdateMailboxDto) {
    const existing = await this.prisma.mailbox.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Mailbox not found');
    }

    let encryptedConfigUpdate: any = undefined;

    if (dto.smtpImapConfig && existing.type === MailboxType.SMTP_IMAP) {
      let currentConfig: any = {};
      try {
        currentConfig = this.vault.decrypt(existing.encryptedConfig as any, true);
      } catch (err) {
        this.logger.warn(`Could not decrypt existing config for mailbox ${id}`);
      }

      const mergedConfig = {
        smtpHost: dto.smtpImapConfig.smtpHost ?? currentConfig.smtpHost,
        smtpPort: dto.smtpImapConfig.smtpPort ?? currentConfig.smtpPort,
        smtpSecurity: dto.smtpImapConfig.smtpSecurity ?? currentConfig.smtpSecurity ?? 'tls',
        smtpUser: dto.smtpImapConfig.smtpUser ?? currentConfig.smtpUser,
        smtpPass: (dto.smtpImapConfig.smtpPass && dto.smtpImapConfig.smtpPass.trim())
          ? dto.smtpImapConfig.smtpPass.trim()
          : currentConfig.smtpPass,
        imapHost: dto.smtpImapConfig.imapHost ?? currentConfig.imapHost,
        imapPort: dto.smtpImapConfig.imapPort ?? currentConfig.imapPort,
        imapSecurity: dto.smtpImapConfig.imapSecurity ?? currentConfig.imapSecurity ?? 'ssl',
        imapUser: dto.smtpImapConfig.imapUser ?? currentConfig.imapUser,
        imapPass: (dto.smtpImapConfig.imapPass && dto.smtpImapConfig.imapPass.trim())
          ? dto.smtpImapConfig.imapPass.trim()
          : currentConfig.imapPass,
      };

      // Verify SMTP if credentials or host changed
      if (
        (dto.smtpImapConfig.smtpPass && dto.smtpImapConfig.smtpPass.trim()) ||
        dto.smtpImapConfig.smtpHost !== currentConfig.smtpHost ||
        dto.smtpImapConfig.smtpUser !== currentConfig.smtpUser
      ) {
        try {
          await this.smtpValidator.verifySmtp(mergedConfig);
        } catch (err: any) {
          this.logger.warn(`SMTP verification on update returned warning: ${err?.message}`);
        }
      }

      // Verify IMAP if credentials or host changed
      if (
        (dto.smtpImapConfig.imapPass && dto.smtpImapConfig.imapPass.trim()) ||
        dto.smtpImapConfig.imapHost !== currentConfig.imapHost ||
        dto.smtpImapConfig.imapUser !== currentConfig.imapUser
      ) {
        if (mergedConfig.imapHost) {
          try {
            await this.smtpValidator.verifyImap(mergedConfig);
          } catch (err: any) {
            this.logger.warn(`IMAP verification on update returned warning: ${err?.message}`);
          }
        }
      }

      encryptedConfigUpdate = this.vault.encrypt(mergedConfig);
    }

    const updated = await this.prisma.mailbox.update({
      where: { id },
      data: {
        state: dto.state,
        dailySendingLimit: dto.dailySendingLimit,
        warmupDailyLimit: dto.warmupDailyLimit,
        hourlyLimit: dto.hourlyLimit,
        minDelaySeconds: dto.minDelaySeconds,
        displayName: dto.displayName,
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail,
        ...(encryptedConfigUpdate ? { encryptedConfig: encryptedConfigUpdate } : {}),
      },
      select: {
        id: true,
        email: true,
        state: true,
        displayName: true,
        senderName: true,
        replyToEmail: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        hourlyLimit: true,
        sentCountToday: true,
        sentThisHour: true,
        minDelaySeconds: true,
      },
    });

    await this.auditService.log({
      action: 'MAILBOX_UPDATE',
      targetEntity: 'Mailbox',
      targetId: id,
      metadata: { ...dto, smtpImapConfig: dto.smtpImapConfig ? 'REDACTED' : undefined },
      status: 'success',
    });

    return updated;
  }

  async testConnection(id: string) {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id } });
    if (!mailbox) {
      throw new NotFoundException('Mailbox not found');
    }

    try {
      const config = await this.getDecryptedConfig(id);
      if (mailbox.type === MailboxType.SMTP_IMAP) {
        await this.smtpValidator.verifySmtp(config);
        if (config?.imapHost) {
          await this.smtpValidator.verifyImap(config);
        }
      }
      return { success: true, message: 'SMTP and IMAP connections verified successfully' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to verify connection' };
    }
  }

  async remove(id: string) {
    const mailbox = await this.findOne(id);
    const deleted = await this.prisma.mailbox.delete({
      where: { id },
    });

    await this.auditService.log({
      action: 'MAILBOX_DELETE',
      targetEntity: 'Mailbox',
      targetId: id,
      metadata: { email: mailbox.email },
      status: 'success',
    });

    return deleted;
  }

  /**
   * Internal helper: safely retrieve and decrypt credentials for dispatch
   */
  async getDecryptedConfig(id: string): Promise<any> {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id },
    });
    if (!mailbox) {
      throw new NotFoundException('Mailbox not found');
    }
    return this.vault.decrypt(mailbox.encryptedConfig as any, true);
  }

  /**
   * Real-time hourly sent count for a mailbox across ALL campaigns.
   * Uses EmailLog.sentAt from the start of the current clock hour.
   * Resets cleanly every hour on the hour.
   */
  async getMailboxHourlySentCount(mailboxId: string): Promise<number> {
    const startOfHour = new Date();
    startOfHour.setMinutes(0, 0, 0);
    return this.prisma.emailLog.count({
      where: {
        mailboxId,
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gte: startOfHour },
      },
    });
  }

  /**
   * Mailbox pool rotation: return the least-recently-used healthy mailbox
   * that still has capacity within its hourly and daily limits.
   * Hourly usage is computed in real-time from EmailLog to correctly
   * handle mailboxes shared across multiple campaigns.
   */
  async getAvailableMailboxForCampaign(campaignId: string) {
    const pool = await this.prisma.campaignMailbox.findMany({
      where: {
        campaignId,
        mailbox: {
          state: { in: [MailboxState.ACTIVE, MailboxState.WARMING] },
        },
      },
      include: { mailbox: true },
    });

    if (pool.length === 0) return null;

    // Evaluate each mailbox capacity using real-time counts
    const evaluated = await Promise.all(
      pool.map(async (p) => {
        const m = p.mailbox;
        const dailyLimit = m.state === MailboxState.WARMING ? m.warmupDailyLimit : m.dailySendingLimit;
        if (m.sentCountToday >= dailyLimit) return null; // daily cap hit

        const hourlySent = await this.getMailboxHourlySentCount(m.id);
        if (hourlySent >= (m.hourlyLimit || 10)) return null; // hourly cap hit

        return { mailbox: m, hourlySent };
      }),
    );

    const eligible = evaluated.filter((e): e is NonNullable<typeof e> => e !== null);
    if (eligible.length === 0) return null;

    // Rotate via least-recently-used
    eligible.sort((a, b) => {
      const aTime = a.mailbox.lastSentAt ? a.mailbox.lastSentAt.getTime() : 0;
      const bTime = b.mailbox.lastSentAt ? b.mailbox.lastSentAt.getTime() : 0;
      return aTime - bTime;
    });

    return eligible[0].mailbox;
  }

  /**
   * Hourly Job: reset mailbox hourly sent counters
   */
  @Cron(CronExpression.EVERY_HOUR)
  async resetHourlySentCounters() {
    await this.prisma.mailbox.updateMany({
      data: { sentThisHour: 0 },
    });
  }

  /**
   * Daily Midnight UTC Job: reset daily sent counts
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailySentCounters() {
    this.logger.log('Resetting mailbox daily sent counters (Midnight UTC)...');
    await this.prisma.mailbox.updateMany({
      data: { sentCountToday: 0, sentThisHour: 0 },
    });
    this.logger.log('Mailbox daily counters reset completed.');
  }

  async getWarmupPlan(mailboxId: string) {
    await this.findOne(mailboxId);
    let plan = await this.prisma.warmupPlan.findUnique({
      where: { mailboxId },
    });
    if (!plan) {
      plan = await this.prisma.warmupPlan.create({
        data: {
          mailboxId,
          currentDailyLimit: 10,
          targetDailyLimit: 50,
          rampUpStep: 5,
          replyRatePercent: 30,
          status: 'active',
        },
      });
    }
    return plan;
  }

  async updateWarmupPlan(mailboxId: string, dto: any) {
    await this.findOne(mailboxId);
    return this.prisma.warmupPlan.upsert({
      where: { mailboxId },
      update: {
        currentDailyLimit: dto.currentDailyLimit,
        targetDailyLimit: dto.targetDailyLimit,
        rampUpStep: dto.rampUpStep,
        replyRatePercent: dto.replyRatePercent,
        status: dto.status,
      },
      create: {
        mailboxId,
        currentDailyLimit: dto.currentDailyLimit || 10,
        targetDailyLimit: dto.targetDailyLimit || 50,
        rampUpStep: dto.rampUpStep || 5,
        replyRatePercent: dto.replyRatePercent || 30,
        status: dto.status || 'active',
      },
    });
  }

  async getWarmupMatrix() {
    const mailboxes = await this.prisma.mailbox.findMany({
      select: {
        id: true,
        email: true,
        state: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        sentCountToday: true,
        warmupPlan: true,
      },
    });

    return mailboxes.map((m) => ({
      mailboxId: m.id,
      email: m.email,
      state: m.state,
      dailySendingLimit: m.dailySendingLimit,
      sentCountToday: m.sentCountToday,
      warmupPlan: m.warmupPlan || {
        currentDailyLimit: m.warmupDailyLimit,
        targetDailyLimit: m.dailySendingLimit,
        rampUpStep: 5,
        replyRatePercent: 30,
        status: m.state === 'WARMING' ? 'active' : 'paused',
      },
    }));
  }
}

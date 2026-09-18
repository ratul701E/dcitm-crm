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
  ) {}

  async create(dto: CreateMailboxDto) {
    const email = dto.email.toLowerCase().trim();

    // Verify domain exists
    const domain = await this.prisma.domain.findUnique({
      where: { id: dto.domainId },
    });
    if (!domain) {
      throw new NotFoundException('Specified domain does not exist');
    }

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
        domainId: dto.domainId,
        type: dto.type,
        state: MailboxState.WARMING,
        encryptedConfig: encryptedConfig as any,
        dailySendingLimit: dto.dailySendingLimit || 50,
        warmupDailyLimit: dto.warmupDailyLimit || 10,
        minDelaySeconds: dto.minDelaySeconds || 90,
      },
      select: {
        id: true,
        email: true,
        domainId: true,
        type: true,
        state: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        sentCountToday: true,
        minDelaySeconds: true,
        createdAt: true,
      },
    });

    return mailbox;
  }

  async findAll() {
    return this.prisma.mailbox.findMany({
      select: {
        id: true,
        email: true,
        domainId: true,
        domain: { select: { name: true } },
        type: true,
        state: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        sentCountToday: true,
        minDelaySeconds: true,
        lastSentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        domainId: true,
        domain: { select: { name: true, dkimSelector: true } },
        type: true,
        state: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        sentCountToday: true,
        minDelaySeconds: true,
        lastSentAt: true,
        createdAt: true,
      },
    });
    if (!mailbox) {
      throw new NotFoundException('Mailbox not found');
    }
    return mailbox;
  }

  async update(id: string, dto: UpdateMailboxDto) {
    await this.findOne(id);
    return this.prisma.mailbox.update({
      where: { id },
      data: {
        state: dto.state,
        dailySendingLimit: dto.dailySendingLimit,
        warmupDailyLimit: dto.warmupDailyLimit,
        minDelaySeconds: dto.minDelaySeconds,
      },
      select: {
        id: true,
        email: true,
        state: true,
        dailySendingLimit: true,
        warmupDailyLimit: true,
        minDelaySeconds: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.mailbox.delete({
      where: { id },
    });
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
   * Mailbox pool rotation helper: fetch least-recently-used healthy mailbox
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

    const eligible = pool.map((p) => p.mailbox).filter((m) => {
      const limit =
        m.state === MailboxState.WARMING
          ? m.warmupDailyLimit
          : m.dailySendingLimit;
      return m.sentCountToday < limit;
    });

    if (eligible.length === 0) {
      return null;
    }

    // Sort by least recently used
    eligible.sort((a, b) => {
      const aTime = a.lastSentAt ? a.lastSentAt.getTime() : 0;
      const bTime = b.lastSentAt ? b.lastSentAt.getTime() : 0;
      return aTime - bTime;
    });

    return eligible[0];
  }

  /**
   * Daily Midnight UTC Job: reset daily sent counts
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailySentCounters() {
    this.logger.log('Resetting mailbox daily sent counters (Midnight UTC)...');
    await this.prisma.mailbox.updateMany({
      data: { sentCountToday: 0 },
    });
    this.logger.log('Mailbox daily counters reset completed.');
  }
}

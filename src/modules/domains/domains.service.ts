import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DnsAuditorService } from './dns-auditor.service';
import { CreateDomainDto, UpdateDomainDto } from './dto/domain.dto';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dnsAuditor: DnsAuditorService,
  ) {}

  async create(dto: CreateDomainDto) {
    const domainName = dto.name.toLowerCase().trim();
    const existing = await this.prisma.domain.findUnique({
      where: { name: domainName },
    });
    if (existing) {
      throw new ConflictException(`Domain ${domainName} is already registered`);
    }

    const domain = await this.prisma.domain.create({
      data: {
        name: domainName,
        dkimSelector: dto.dkimSelector || 'google',
        redirectUrl: dto.redirectUrl,
      },
    });

    // Run immediate DNS check asynchronously
    this.verifyDns(domain.id).catch((err) =>
      this.logger.warn(`Initial DNS audit failed for ${domainName}: ${err.message}`),
    );

    return domain;
  }

  async findAll() {
    return this.prisma.domain.findMany({
      include: {
        _count: {
          select: { mailboxes: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id },
      include: {
        mailboxes: {
          select: {
            id: true,
            email: true,
            type: true,
            state: true,
            sentCountToday: true,
            dailySendingLimit: true,
          },
        },
      },
    });
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  async update(id: string, dto: UpdateDomainDto) {
    await this.findOne(id);
    return this.prisma.domain.update({
      where: { id },
      data: {
        dkimSelector: dto.dkimSelector,
        redirectUrl: dto.redirectUrl,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.domain.delete({
      where: { id },
    });
  }

  /**
   * On-demand DNS audit trigger
   */
  async verifyDns(id: string) {
    const domain = await this.findOne(id);
    const results = await this.dnsAuditor.auditDomain(
      domain.name,
      domain.dkimSelector,
    );

    const updated = await this.prisma.domain.update({
      where: { id },
      data: {
        spfRecordPass: results.spfRecordPass,
        dkimRecordPass: results.dkimRecordPass,
        dmarcRecordPass: results.dmarcRecordPass,
        mxRecordPass: results.mxRecordPass,
        ctdCnamePass: results.ctdCnamePass,
        lastDnsCheckedAt: new Date(),
      },
    });

    return {
      domain: updated,
      diagnostics: results.details,
    };
  }

  /**
   * Daily DNS Health Auditor (Midnight UTC)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyDnsAudit() {
    this.logger.log('Starting daily DNS portfolio audit...');
    const domains = await this.prisma.domain.findMany();
    for (const domain of domains) {
      try {
        await this.verifyDns(domain.id);
      } catch (err: any) {
        this.logger.error(`DNS check failed for ${domain.name}: ${err.message}`);
      }
    }
    this.logger.log(`Completed DNS audit for ${domains.length} domains.`);
  }
}

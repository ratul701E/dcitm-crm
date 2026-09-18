import { Module } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { DomainsController } from './domains.controller';
import { DnsAuditorService } from './dns-auditor.service';

@Module({
  controllers: [DomainsController],
  providers: [DomainsService, DnsAuditorService],
  exports: [DomainsService, DnsAuditorService],
})
export class DomainsModule {}

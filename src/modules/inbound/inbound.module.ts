import { Module } from '@nestjs/common';
import { BounceParserService } from './bounce-parser.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { InboundSyncService } from './inbound-sync.service';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { SuppressionModule } from '../suppression/suppression.module';

@Module({
  imports: [MailboxesModule, SuppressionModule],
  providers: [BounceParserService, CircuitBreakerService, InboundSyncService],
  exports: [BounceParserService, CircuitBreakerService, InboundSyncService],
})
export class InboundModule {}

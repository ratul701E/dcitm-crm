import { Module } from '@nestjs/common';
import { UniboxService } from './unibox.service';
import { UniboxController } from './unibox.controller';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { SuppressionModule } from '../suppression/suppression.module';

import { InboundModule } from '../inbound/inbound.module';

@Module({
  imports: [MailboxesModule, DispatcherModule, SuppressionModule, InboundModule],
  controllers: [UniboxController],
  providers: [UniboxService],
  exports: [UniboxService],
})
export class UniboxModule {}

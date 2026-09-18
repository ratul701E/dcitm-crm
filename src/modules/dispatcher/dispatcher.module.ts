import { Module } from '@nestjs/common';
import { ProviderAdaptersService } from './provider-adapters.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { MailboxesModule } from '../mailboxes/mailboxes.module';

@Module({
  imports: [MailboxesModule],
  providers: [ProviderAdaptersService, DispatchQueueService],
  exports: [DispatchQueueService, ProviderAdaptersService],
})
export class DispatcherModule {}

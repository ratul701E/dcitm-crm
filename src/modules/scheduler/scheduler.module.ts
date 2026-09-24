import { Module } from '@nestjs/common';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { EmailDelayModule } from '../campaigns/email-delay.module';

@Module({
  imports: [DispatcherModule, MailboxesModule, EmailDelayModule],
  providers: [CampaignSchedulerService],
  exports: [CampaignSchedulerService],
})
export class SchedulerModule {}


import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

import { EmailDelayModule } from './email-delay.module';
import { EmailDelayService } from './email-delay.service';

@Module({
  imports: [MailboxesModule, DispatcherModule, SchedulerModule, EmailDelayModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService, EmailDelayModule],
})
export class CampaignsModule {}

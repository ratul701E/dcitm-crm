import { Module } from '@nestjs/common';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { DispatcherModule } from '../dispatcher/dispatcher.module';

@Module({
  imports: [DispatcherModule],
  providers: [CampaignSchedulerService],
  exports: [CampaignSchedulerService],
})
export class SchedulerModule {}

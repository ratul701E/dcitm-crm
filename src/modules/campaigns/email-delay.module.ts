import { Module } from '@nestjs/common';
import { EmailDelayService } from './email-delay.service';

@Module({
  providers: [EmailDelayService],
  exports: [EmailDelayService],
})
export class EmailDelayModule {}

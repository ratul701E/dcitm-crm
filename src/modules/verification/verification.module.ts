import { Module } from '@nestjs/common';
import { VerificationProviderService } from './verification-provider.service';
import { VerificationQueueService } from './verification-queue.service';
import { VerificationController } from './verification.controller';

@Module({
  controllers: [VerificationController],
  providers: [VerificationProviderService, VerificationQueueService],
  exports: [VerificationQueueService, VerificationProviderService],
})
export class VerificationModule {}

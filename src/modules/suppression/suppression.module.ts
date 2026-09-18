import { Global, Module } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { SuppressionController } from './suppression.controller';
import { UnsubscribeService } from './unsubscribe.service';
import { PreSendGatekeeperService } from './pre-send-gatekeeper.service';

@Global()
@Module({
  controllers: [SuppressionController],
  providers: [
    SuppressionService,
    UnsubscribeService,
    PreSendGatekeeperService,
  ],
  exports: [
    SuppressionService,
    UnsubscribeService,
    PreSendGatekeeperService,
  ],
})
export class SuppressionModule {}

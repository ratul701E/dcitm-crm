import { Global, Module } from '@nestjs/common';
import { SpintaxService } from './spintax.service';

@Global()
@Module({
  providers: [SpintaxService],
  exports: [SpintaxService],
})
export class SpintaxModule {}

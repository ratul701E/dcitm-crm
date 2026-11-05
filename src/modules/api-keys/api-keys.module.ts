import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { MailSendController } from './mail-send.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [MailboxesModule, DispatcherModule, AuditModule],
  controllers: [ApiKeysController, MailSendController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}


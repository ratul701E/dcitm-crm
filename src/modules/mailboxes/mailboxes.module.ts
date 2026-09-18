import { Module } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { SmtpValidatorService } from './smtp-validator.service';

@Module({
  controllers: [MailboxesController],
  providers: [MailboxesService, SmtpValidatorService],
  exports: [MailboxesService],
})
export class MailboxesModule {}

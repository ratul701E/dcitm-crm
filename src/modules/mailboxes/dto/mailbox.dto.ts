import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MailboxType, MailboxState } from '@prisma/client';

export const SmtpImapConfigSchema = z.object({
  smtpHost: z.string().min(1, 'smtpHost is required').describe('SMTP host server (e.g. smtp.office365.com)'),
  smtpPort: z.number().int().describe('SMTP port (e.g. 587 or 465)'),
  smtpUser: z.string().min(1, 'smtpUser is required').describe('SMTP username or email'),
  smtpPass: z.string().min(1, 'smtpPass is required').describe('SMTP password or app password'),
  imapHost: z.string().min(1, 'imapHost is required').describe('IMAP host server (e.g. outlook.office365.com)'),
  imapPort: z.number().int().describe('IMAP port (e.g. 993)'),
  imapUser: z.string().min(1, 'imapUser is required').describe('IMAP username or email'),
  imapPass: z.string().min(1, 'imapPass is required').describe('IMAP password or app password'),
});

export class SmtpImapConfigDto extends createZodDto(SmtpImapConfigSchema) {}

export const OAuthConnectSchema = z.object({
  authCode: z.string().min(1, 'authCode is required').describe('OAuth2 authorization code from provider callback'),
  redirectUri: z.string().url().optional().describe('OAuth callback redirect URI'),
});

export class OAuthConnectDto extends createZodDto(OAuthConnectSchema) {}

export const CreateMailboxSchema = z.object({
  email: z.string().email('Invalid email address').describe('Sender email address'),
  domainId: z.string().min(1, 'domainId is required').describe('Associated domain UUID'),
  type: z.nativeEnum(MailboxType).describe('Mailbox protocol type (SMTP_IMAP, GOOGLE_WORKSPACE, MICROSOFT_365)'),
  smtpImapConfig: SmtpImapConfigSchema.optional().describe('Required when type is SMTP_IMAP'),
  oauthConfig: OAuthConnectSchema.optional().describe('Required when type is GOOGLE_WORKSPACE or MICROSOFT_365'),
  dailySendingLimit: z.number().int().min(1).max(500).default(50).optional().describe('Maximum allowed emails sent per 24-hour cycle'),
  warmupDailyLimit: z.number().int().min(1).default(10).optional().describe('Starting daily limit during mailbox warmup phase'),
  minDelaySeconds: z.number().int().min(10).default(90).optional().describe('Jitter delay floor between consecutive sends'),
});

export class CreateMailboxDto extends createZodDto(CreateMailboxSchema) {}

export const UpdateMailboxSchema = z.object({
  state: z.nativeEnum(MailboxState).optional().describe('Mailbox operational health status'),
  dailySendingLimit: z.number().int().min(1).max(1000).optional().describe('Sending quota per day'),
  warmupDailyLimit: z.number().int().min(1).optional().describe('Warmup limit ceiling'),
  minDelaySeconds: z.number().int().min(10).optional().describe('Minimum pause between sends in seconds'),
});

export class UpdateMailboxDto extends createZodDto(UpdateMailboxSchema) {}

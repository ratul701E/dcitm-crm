import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).describe('Descriptive name for the API key'),
  mailboxId: z.string().uuid('Valid mailbox UUID is required').describe('ID of the email account/mailbox in CRM'),
  rateLimitPerHour: z.number().int().min(1).max(5000).optional().default(100).describe('Hourly sending limit'),
  expiresAt: z.string().datetime().optional().nullable().describe('Optional ISO expiration date'),
});

export class CreateApiKeyDto extends createZodDto(CreateApiKeySchema) {}

export const UpdateApiKeySchema = z.object({
  name: z.string().min(2).max(100).optional().describe('Updated name for the API key'),
  isActive: z.boolean().optional().describe('Active status'),
  rateLimitPerHour: z.number().int().min(1).max(5000).optional().describe('Updated hourly sending limit'),
  expiresAt: z.string().datetime().optional().nullable().describe('Updated ISO expiration date'),
});

export class UpdateApiKeyDto extends createZodDto(UpdateApiKeySchema) {}

export const SendEmailSchema = z
  .object({
    to: z
      .union([
        z.string().email('Invalid recipient email address'),
        z.array(z.string().email('Invalid recipient email address')).min(1, 'At least one recipient is required'),
      ])
      .describe('Recipient email address or array of addresses'),
    subject: z.string().min(1, 'Subject is required').max(500).describe('Email subject line'),
    html: z.string().optional().describe('HTML formatted body content'),
    text: z.string().optional().describe('Plain text fallback body content'),
    fromName: z.string().optional().describe('Optional sender display name (overrides mailbox default)'),
    replyTo: z.string().email('Invalid reply-to email address').optional().describe('Optional reply-to email'),
    cc: z
      .union([z.string().email(), z.array(z.string().email())])
      .optional()
      .describe('Optional CC email address(es)'),
    bcc: z
      .union([z.string().email(), z.array(z.string().email())])
      .optional()
      .describe('Optional BCC email address(es)'),
  })
  .refine((data) => Boolean(data.html || data.text), {
    message: 'Either "html" or "text" must be provided',
    path: ['html'],
  });

export class SendEmailDto extends createZodDto(SendEmailSchema) {}


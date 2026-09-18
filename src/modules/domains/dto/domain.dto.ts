import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateDomainSchema = z.object({
  name: z
    .string()
    .min(1, 'Domain name is required')
    .describe('Sending domain name (e.g. outreach.example.com)'),
  dkimSelector: z
    .string()
    .default('google')
    .optional()
    .describe('DKIM selector (defaults to google)'),
  redirectUrl: z
    .string()
    .url('Must be a valid URL')
    .optional()
    .describe('Redirect fallback URL for tracking domain (e.g. https://example.com)'),
});

export class CreateDomainDto extends createZodDto(CreateDomainSchema) {}

export const UpdateDomainSchema = z.object({
  dkimSelector: z
    .string()
    .optional()
    .describe('Custom DKIM selector (e.g. k1)'),
  redirectUrl: z
    .string()
    .url('Must be a valid URL')
    .optional()
    .describe('Redirect destination URL'),
});

export class UpdateDomainDto extends createZodDto(UpdateDomainSchema) {}

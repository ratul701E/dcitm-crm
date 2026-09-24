import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SuppressionReason } from '@prisma/client';

export const CreateSuppressionSchema = z.object({
  value: z
    .string()
    .min(1, 'Suppression value is required')
    .describe('Suppression target: specific email (user@example.com) or domain wildcard (@example.com)'),
  reason: z
    .nativeEnum(SuppressionReason)
    .describe('Reason for suppression (UNSUBSCRIBE, BOUNCE, SPAM_COMPLAINT, MANUAL_DNC)'),
  source: z
    .string()
    .optional()
    .describe('Audit origin of the suppression record'),
  notes: z
    .string()
    .optional()
    .describe('Optional internal notes or reasoning'),
});

export class CreateSuppressionDto extends createZodDto(CreateSuppressionSchema) {}

export const BulkSuppressionSchema = z.object({
  values: z
    .array(z.string().min(1))
    .min(1, 'At least one value is required')
    .describe('List of email addresses or @domains to bulk suppress'),
  reason: z
    .nativeEnum(SuppressionReason)
    .describe('Reason for suppression'),
  notes: z
    .string()
    .optional()
    .describe('Optional internal notes or reasoning'),
});

export class BulkSuppressionDto extends createZodDto(BulkSuppressionSchema) {}

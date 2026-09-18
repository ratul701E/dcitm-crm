import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateVariantSchema = z.object({
  variantKey: z.string().min(1, 'variantKey is required').describe('A/B variant identifier (e.g. A, B)'),
  weight: z
    .number()
    .min(0)
    .max(100)
    .describe('Traffic split weight percentage (0-100)'),
  subject: z
    .string()
    .min(1, 'subject is required')
    .describe('Email subject line with optional spintax and variables'),
  body: z
    .string()
    .min(1, 'body is required')
    .describe('HTML email body content with spintax support'),
});

export class CreateVariantDto extends createZodDto(CreateVariantSchema) {}

export const CreateStepSchema = z.object({
  stepOrder: z.number().int().min(1).describe('Sequence step position order (1, 2, 3...)'),
  delayDays: z.number().int().min(0).default(3).optional().describe('Wait duration in days after previous step'),
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(23)
    .default(0)
    .optional()
    .describe('Wait duration in hours after previous step'),
  variants: z
    .array(CreateVariantSchema)
    .min(1, 'At least one variant is required')
    .describe('A/B copy variants for this sequence step'),
});

export class CreateStepDto extends createZodDto(CreateStepSchema) {}

export const UpdateStepSchema = z.object({
  delayDays: z.number().int().min(0).optional().describe('Wait duration in days after previous step'),
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .describe('Wait duration in hours after previous step'),
  variants: z
    .array(CreateVariantSchema)
    .optional()
    .describe('A/B copy variants for this sequence step'),
});

export class UpdateStepDto extends createZodDto(UpdateStepSchema) {}

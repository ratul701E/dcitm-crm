import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateVariantSchema = z.object({
  variantKey: z.string().default('A').optional().describe('A/B variant identifier (e.g. A, B)'),
  weight: z
    .number()
    .min(0)
    .max(100)
    .default(100)
    .optional()
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

export const CreateStepSchema = z
  .object({
    title: z.string().optional().describe('Phase / step title (e.g. Phase 1: Initial Pitch)'),
    stepOrder: z.number().int().min(1).optional().describe('Sequence step position order (1, 2, 3...)'),
    position: z.number().int().min(1).optional().describe('Alias for stepOrder'),
    delayDays: z.number().int().min(0).default(0).optional().describe('Wait duration in days after previous step'),
    delayHours: z
      .number()
      .int()
      .min(0)
      .max(23)
      .default(0)
      .optional()
      .describe('Wait duration in hours after previous step'),
    scheduledAt: z
      .string()
      .nullable()
      .optional()
      .describe('Specific target ISO date and time when this step is sent'),
    subject: z.string().optional().describe('Email subject line (convenience shorthand for single variant)'),
    body: z.string().optional().describe('HTML email body (convenience shorthand for single variant)'),
    variants: z
      .array(CreateVariantSchema)
      .optional()
      .describe('A/B copy variants for this sequence step'),
  })
  .refine(
    (data) => (data.variants && data.variants.length > 0) || (Boolean(data.subject) && Boolean(data.body)),
    {
      message: 'Either variants array or both subject and body must be provided',
      path: ['variants'],
    },
  );

export class CreateStepDto extends createZodDto(CreateStepSchema) {}

export const UpdateStepSchema = z.object({
  title: z.string().optional().describe('Phase / step title'),
  delayDays: z.number().int().min(0).optional().describe('Wait duration in days after previous step'),
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .describe('Wait duration in hours after previous step'),
  scheduledAt: z
    .string()
    .nullable()
    .optional()
    .describe('Specific target ISO date and time when this step is sent'),
  status: z.string().optional().describe('Phase state (ACTIVE, PAUSED)'),
  subject: z.string().optional().describe('Updated subject line for primary variant'),
  body: z.string().optional().describe('Updated body for primary variant'),
  variants: z
    .array(CreateVariantSchema)
    .optional()
    .describe('A/B copy variants for this sequence step'),
});

export class UpdateStepDto extends createZodDto(UpdateStepSchema) {}

export const ReorderStepsSchema = z.object({
  stepIds: z.array(z.string().uuid()).min(1).describe('Ordered array of step UUIDs'),
});

export class ReorderStepsDto extends createZodDto(ReorderStepsSchema) {}

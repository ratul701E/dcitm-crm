import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').describe('Template name'),
  subject: z.string().min(1, 'Subject is required').describe('Subject line'),
  body: z.string().default('').describe('Legacy plain-text body content'),
  htmlContent: z.string().optional().describe('Rendered email-safe HTML (cached from renderer)'),
  designJson: z.record(z.string(), z.any()).optional().describe('Visual builder canonical JSON'),
  description: z.string().optional().describe('Template description'),
  previewText: z.string().optional().describe('Email preview / snippet text shown in inbox'),
  category: z.string().default('general').optional().describe('Template category'),
  variables: z.array(z.string()).default([]).optional().describe('Detected placeholder variables'),
});

export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().optional(),
  htmlContent: z.string().optional(),
  designJson: z.record(z.string(), z.any()).optional(),
  description: z.string().optional(),
  previewText: z.string().optional(),
  category: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

export class UpdateTemplateDto extends createZodDto(UpdateTemplateSchema) {}

export const RenderTemplateSchema = z.object({
  designJson: z.record(z.string(), z.any()).describe('Design JSON to render to HTML'),
});

export class RenderTemplateDto extends createZodDto(RenderTemplateSchema) {}

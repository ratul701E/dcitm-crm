import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSegmentSchema = z.object({
  name: z.string().min(1, 'Name is required').describe('Segment name'),
  description: z.string().optional().describe('Segment description'),
  conditions: z.any().describe('Filter conditions or rules JSON'),
  count: z.number().int().default(0).optional(),
});

export class CreateSegmentDto extends createZodDto(CreateSegmentSchema) {}

export const UpdateSegmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  conditions: z.any().optional(),
  count: z.number().int().optional(),
});

export class UpdateSegmentDto extends createZodDto(UpdateSegmentSchema) {}

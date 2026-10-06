import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Search query cannot be empty')
    .describe('Search query string'),
  limit: z
    .coerce
    .number()
    .int()
    .positive()
    .max(20)
    .default(5)
    .optional()
    .describe('Maximum number of items to return per category'),
});

export class SearchQueryDto extends createZodDto(SearchQuerySchema) {}

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').describe('Category or industry name'),
  description: z.string().optional().describe('Description of the category or niche'),
  parentId: z.string().uuid().optional().nullable().describe('Parent industry UUID. Empty or null for Industry; Industry UUID for Subcategory.'),
});

export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}

export const UpdateCategorySchema = z.object({
  name: z.string().min(1, 'Category name cannot be empty').optional().describe('Updated category name'),
  description: z.string().optional().nullable().describe('Updated description'),
});

export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}

export const MoveCategorySchema = z.object({
  targetParentId: z.string().uuid().optional().nullable().describe('Target industry UUID to move this subcategory into'),
  newParentId: z.string().uuid().optional().nullable().describe('Target industry UUID to move this subcategory into'),
});

export class MoveCategoryDto extends createZodDto(MoveCategorySchema) {}

export const DeleteCategorySchema = z.object({
  confirmationName: z.string().optional().describe('Category name confirmation'),
  strategy: z.enum(['REASSIGN_TO_PARENT', 'CASCADE_DELETE_SUBCATEGORIES']).optional(),
  resolutionOption: z.enum([
    'MOVE_SUBCATEGORIES_TO_ANOTHER_INDUSTRY',
    'CASCADE_TO_UNASSIGNED',
  ]).optional().describe('Resolution choice for industry deletion'),
  targetCategoryId: z.string().uuid().optional(),
  targetIndustryId: z.string().uuid().optional().describe('Target industry if moving child subcategories'),
  targetSubcategoryId: z.string().uuid().optional().describe('Target subcategory if moving child groups of a subcategory'),
});

export class DeleteCategoryDto extends createZodDto(DeleteCategorySchema) {}

export const ReorderCategoriesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).optional().describe('Ordered category UUIDs'),
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })).optional().describe('Ordered category items with sortOrder'),
});

export class ReorderCategoriesDto extends createZodDto(ReorderCategoriesSchema) {}

export const MoveLeadListSchema = z.object({
  targetParentCategoryId: z.string().uuid().optional().nullable().describe('Target subcategory UUID or null for Unassigned'),
  parentCategoryId: z.string().uuid().optional().nullable().describe('Alias for targetParentCategoryId'),
  newParentId: z.string().uuid().optional().nullable().describe('Alias for targetParentCategoryId'),
});

export class MoveLeadListDto extends createZodDto(MoveLeadListSchema) {}

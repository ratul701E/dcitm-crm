import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { MigrationService } from './migration.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  MoveCategoryDto,
  DeleteCategoryDto,
  ReorderCategoriesDto,
  MoveLeadListDto,
} from './dto/category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Audience Categories & Groups')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly migrationService: MigrationService,
  ) {}

  @Get('migration/preview')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Preview one-time legacy list organization and verification' })
  @ApiResponse({ status: 200, description: 'Migration preview report returned' })
  previewMigration() {
    return this.migrationService.previewMigration();
  }

  @Post('migration/apply')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Apply one-time legacy list organization' })
  @ApiResponse({ status: 200, description: 'Migration applied successfully' })
  applyMigration(@Request() req: any) {
    const userId = req.user?.id || req.user?.sub || undefined;
    return this.migrationService.applyMigration(userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get 3-level Category Hierarchy Tree',
    description: 'Returns all industries, nested subcategories, audience groups, and summary statistics.',
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Hierarchy tree and summary stats returned' })
  getHierarchyTree(@Query('search') search?: string) {
    return this.categoriesService.getHierarchyTree(search);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Global search across categories, audience groups, and contacts',
  })
  @ApiQuery({ name: 'q', required: true, type: String, description: 'Search term' })
  @ApiResponse({ status: 200, description: 'Categorized search results' })
  globalSearch(@Query('q') query: string) {
    return this.categoriesService.globalSearch(query || '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get category details, breadcrumb, and groups table' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category detail payload' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  getCategoryDetails(@Param('id') id: string) {
    return this.categoriesService.getCategoryDetails(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({
    summary: 'Create Industry (Level 1) or Subcategory (Level 2)',
    description: 'Enforces strict 3-level limit. Cannot nest subcategories under another subcategory.',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Depth or validation violation' })
  createCategory(@Request() req: any, @Body() dto: CreateCategoryDto) {
    const userId = req.user?.id || req.user?.sub || null;
    return this.categoriesService.createCategory(userId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update category name or description' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.updateCategory(id, dto);
  }

  @Post(':id/move')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({
    summary: 'Move subcategory to another industry',
    description: 'Contact memberships never change. Returns protected scheduled campaign notices.',
  })
  @ApiParam({ name: 'id', description: 'Subcategory UUID' })
  @ApiResponse({ status: 200, description: 'Category moved to new parent' })
  moveCategory(@Param('id') id: string, @Body() dto: MoveCategoryDto) {
    return this.categoriesService.moveCategory(id, dto);
  }

  @Post('reorder')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Batch reorder sibling categories within the same parent or root level' })
  @ApiResponse({ status: 200, description: 'Sort orders updated' })
  reorderCategories(@Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorderCategories(dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Delete category non-destructively',
    description: 'Never deletes contacts or groups. Requires user to type confirmation name.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category deleted with contents reassigned' })
  deleteCategory(@Param('id') id: string, @Body() dto: DeleteCategoryDto) {
    return this.categoriesService.deleteCategory(id, dto);
  }

  @Post('groups/:id/move')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({
    summary: 'Move Audience Group to a subcategory or Unassigned lists',
    description: 'Enforces that groups can only be placed under a Subcategory or Unassigned, never an Industry.',
  })
  @ApiParam({ name: 'id', description: 'Audience Group (LeadList) UUID' })
  @ApiResponse({ status: 200, description: 'Group parent category updated' })
  moveLeadList(@Param('id') id: string, @Body() dto: MoveLeadListDto) {
    return this.categoriesService.moveLeadList(id, dto);
  }

  @Post('groups/reorder')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Batch reorder audience groups within a subcategory or unassigned list' })
  @ApiResponse({ status: 200, description: 'Sort orders updated' })
  reorderLeadLists(@Body() body: { orderedIds: string[] }) {
    return this.categoriesService.reorderLeadLists(body.orderedIds || []);
  }
}

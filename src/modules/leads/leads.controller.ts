import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import {
  CreateLeadListDto,
  CreateLeadDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Leads & Lists')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // --------------------------------------------------
  // Subscribers Static List Auto-Enrollment Endpoint
  // --------------------------------------------------
  @Post('subscribe')
  @Public()
  @ApiOperation({
    summary: 'Save or enroll an email lead into the static Subscribers list via POST',
    description: 'Auto-maintains the static Subscribers list, matches any existing lead records across all lists to merge rich contact info, and saves/upserts the contact.',
  })
  @ApiQuery({ name: 'email', required: false, type: String, description: 'Email address of the subscriber' })
  @ApiResponse({ status: 200, description: 'Lead saved or refreshed in Subscribers list successfully' })
  @ApiResponse({ status: 400, description: 'Missing or invalid email address' })
  subscribePost(
    @Query('email') queryEmail?: string,
    @Body() body?: { email?: string },
  ) {
    const email = queryEmail || body?.email;
    return this.leadsService.enrollInSubscribersList(email as string);
  }

  @Get('subscribe')
  @Public()
  @ApiOperation({
    summary: 'Save or enroll an email lead into the static Subscribers list via GET (browser-friendly)',
  })
  @ApiQuery({ name: 'email', required: true, type: String, description: 'Email address of the subscriber' })
  subscribeGet(@Query('email') queryEmail?: string) {
    return this.leadsService.enrollInSubscribersList(queryEmail as string);
  }

  @Post('subscribers')
  @Public()
  @ApiOperation({ summary: 'Alias for POST /subscribe endpoint' })
  @ApiQuery({ name: 'email', required: false, type: String })
  subscribersPost(
    @Query('email') queryEmail?: string,
    @Body() body?: { email?: string },
  ) {
    const email = queryEmail || body?.email;
    return this.leadsService.enrollInSubscribersList(email as string);
  }

  @Get('subscribers')
  @Public()
  @ApiOperation({ summary: 'Alias for GET /subscribe endpoint' })
  @ApiQuery({ name: 'email', required: true, type: String })
  subscribersGet(@Query('email') queryEmail?: string) {
    return this.leadsService.enrollInSubscribersList(queryEmail as string);
  }

  // --------------------------------------------------
  // Lists
  // --------------------------------------------------
  @Post('lists')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Create a new lead list' })
  @ApiResponse({ status: 201, description: 'Lead list created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  createList(@Body() dto: CreateLeadListDto) {
    return this.leadsService.createList(dto);
  }

  @Get('lists')
  @ApiOperation({ summary: 'List all lead lists with lead counts' })
  @ApiResponse({ status: 200, description: 'Lead lists retrieved successfully' })
  findAllLists() {
    return this.leadsService.findAllLists();
  }

  @Get('lists/:id')
  @ApiOperation({ summary: 'Get lead list summary' })
  @ApiParam({ name: 'id', description: 'Lead List UUID' })
  @ApiResponse({ status: 200, description: 'Lead list retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Lead list not found' })
  findListById(@Param('id') id: string) {
    return this.leadsService.findListById(id);
  }

  @Delete('lists/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a lead list and all associated leads' })
  @ApiParam({ name: 'id', description: 'Lead List UUID' })
  @ApiResponse({ status: 200, description: 'Lead list and leads deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Lead list not found' })
  deleteList(@Param('id') id: string) {
    return this.leadsService.deleteList(id);
  }

  // --------------------------------------------------
  // Leads
  // --------------------------------------------------
  @Get()
  @ApiOperation({ summary: 'List all leads across all lists with search, status, and trash filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'listId', required: false, type: String })
  @ApiQuery({ name: 'isTrash', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Paginated leads retrieved successfully' })
  findAllLeads(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('listId') listId?: string,
    @Query('isTrash') isTrash?: string,
  ) {
    return this.leadsService.findAllLeads(page, limit, search, status, listId, isTrash === 'true');
  }

  @Post('lists/create-with-leads')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Create a new list and enroll selected leads' })
  @ApiResponse({ status: 201, description: 'List created and leads enrolled' })
  createListWithLeads(@Body() body: { name: string; description?: string; leadIds: string[] }) {
    return this.leadsService.createListWithLeads(body);
  }

  @Post('lists/:listId/leads')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Add a single lead to a list (upsert by email)' })
  @ApiParam({ name: 'listId', description: 'Lead List UUID' })
  @ApiResponse({ status: 201, description: 'Lead enrolled or updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  createLead(
    @Param('listId') listId: string,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leadsService.createLead(listId, dto);
  }

  @Get('lists/:listId/leads')
  @ApiOperation({ summary: 'Get paginated leads for a specific list' })
  @ApiParam({ name: 'listId', description: 'Lead List UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated leads retrieved successfully' })
  findLeadsByList(
    @Param('listId') listId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.leadsService.findLeadsByList(listId, page, limit, status);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update a lead status or custom fields' })
  @ApiParam({ name: 'id', description: 'Lead UUID' })
  @ApiResponse({ status: 200, description: 'Lead updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.updateLead(id, dto);
  }

  @Post('enroll')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Enroll an existing lead into a target list' })
  @ApiResponse({ status: 201, description: 'Lead enrolled into list successfully' })
  enrollLead(
    @Body() body: { leadId: string; listId: string },
  ) {
    return this.leadsService.enrollLeadInList(body.leadId, body.listId);
  }

  @Post('bulk-delete')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk delete leads by IDs (soft delete to trash)' })
  @ApiResponse({ status: 200, description: 'Leads deleted successfully' })
  bulkDeleteLeads(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkSoftDeleteLeads(body?.ids || []);
  }

  @Post('bulk-soft-delete')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk move leads to trash' })
  @ApiResponse({ status: 200, description: 'Leads moved to trash' })
  bulkSoftDeleteLeads(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkSoftDeleteLeads(body?.ids || []);
  }

  @Post('bulk-restore')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk restore leads from trash' })
  @ApiResponse({ status: 200, description: 'Leads restored' })
  bulkRestoreLeads(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkRestoreLeads(body?.ids || []);
  }

  @Post('bulk-permanent-delete')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk permanently delete leads' })
  @ApiResponse({ status: 200, description: 'Leads permanently deleted' })
  bulkPermanentDeleteLeads(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkPermanentDeleteLeads(body?.ids || []);
  }

  @Delete('bulk')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk delete leads by IDs (DELETE)' })
  @ApiResponse({ status: 200, description: 'Leads deleted successfully' })
  bulkDeleteLeadsDelete(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkSoftDeleteLeads(body?.ids || []);
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Restore a soft-deleted lead' })
  @ApiParam({ name: 'id', description: 'Lead UUID' })
  @ApiResponse({ status: 200, description: 'Lead restored' })
  restoreLead(@Param('id') id: string) {
    return this.leadsService.restoreLead(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Delete a lead (soft-delete by default, permanent if permanent=true)' })
  @ApiParam({ name: 'id', description: 'Lead UUID' })
  @ApiQuery({ name: 'allLists', required: false, type: Boolean })
  @ApiQuery({ name: 'permanent', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lead deleted successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  deleteLead(
    @Param('id') id: string,
    @Query('allLists') allLists?: string,
    @Query('permanent') permanent?: string,
  ) {
    return this.leadsService.deleteLead(id, allLists === 'true', permanent === 'true');
  }

  // --------------------------------------------------
  // Bulk CSV Streaming Upload
  // --------------------------------------------------
  @Post('lists/:listId/import-csv')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk import leads from CSV via high-speed streaming' })
  @ApiParam({ name: 'listId', description: 'Target Lead List UUID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file containing lead records (max 50MB)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'CSV streaming parsed and batch imported; returns count of imported and skipped rows',
  })
  @ApiResponse({ status: 400, description: 'Invalid CSV format or missing file' })
  @UseInterceptors(FileInterceptor('file'))
  importCsv(
    @Param('listId') listId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.leadsService.importCsvStream(listId, file.buffer);
  }
}

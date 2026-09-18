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
import { UserRole } from '@prisma/client';

@ApiTags('Leads & Lists')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

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

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a single lead' })
  @ApiParam({ name: 'id', description: 'Lead UUID' })
  @ApiResponse({ status: 200, description: 'Lead deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  deleteLead(@Param('id') id: string) {
    return this.leadsService.deleteLead(id);
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

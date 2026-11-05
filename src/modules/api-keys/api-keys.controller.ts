import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('API Keys')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new API Key bound to a CRM mailbox' })
  @ApiResponse({ status: 201, description: 'API Key generated (raw key returned once)' })
  @ApiResponse({ status: 400, description: 'Mailbox in invalid state or validation error' })
  @ApiResponse({ status: 404, description: 'Mailbox not found' })
  create(@CurrentUser() user: any, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(dto, user?.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'List all API Keys and their associated mailboxes' })
  @ApiResponse({ status: 200, description: 'API Keys retrieved successfully' })
  findAll() {
    return this.apiKeysService.findAll();
  }

  @Get('logs')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Get transactional email dispatch logs' })
  @ApiQuery({ name: 'apiKeyId', required: false, description: 'Filter by API Key ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getLogs(
    @Query('apiKeyId') apiKeyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.apiKeysService.getLogs(
      apiKeyId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Get API Key metadata by ID' })
  @ApiParam({ name: 'id', description: 'API Key UUID' })
  findOne(@Param('id') id: string) {
    return this.apiKeysService.findOne(id);
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle active status of an API Key' })
  @ApiParam({ name: 'id', description: 'API Key UUID' })
  toggleActive(@CurrentUser() user: any, @Param('id') id: string) {
    return this.apiKeysService.toggleActive(id, user?.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update API Key metadata' })
  @ApiParam({ name: 'id', description: 'API Key UUID' })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeysService.update(id, dto, user?.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Permanently revoke and delete an API Key' })
  @ApiParam({ name: 'id', description: 'API Key UUID' })
  @ApiResponse({ status: 200, description: 'API Key deleted' })
  @ApiResponse({ status: 404, description: 'API Key not found' })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.apiKeysService.remove(id, user?.id);
  }
}


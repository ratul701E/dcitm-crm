import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { MailboxesService } from './mailboxes.service';
import { CreateMailboxDto, UpdateMailboxDto } from './dto/mailbox.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Mailboxes')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mailboxes')
export class MailboxesController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Connect a new mailbox with encrypted credentials' })
  @ApiResponse({ status: 201, description: 'Mailbox connected and credentials securely stored' })
  @ApiResponse({ status: 400, description: 'Validation error or invalid credentials' })
  create(@Body() dto: CreateMailboxDto) {
    return this.mailboxesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all mailboxes and health states' })
  @ApiResponse({ status: 200, description: 'Mailboxes retrieved successfully' })
  findAll() {
    return this.mailboxesService.findAll();
  }

  @Get('warmup/matrix')
  @ApiOperation({ summary: 'Get warmup progress matrix for all mailboxes' })
  @ApiResponse({ status: 200, description: 'Warmup matrix retrieved' })
  getWarmupMatrix() {
    return this.mailboxesService.getWarmupMatrix();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific mailbox' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Mailbox details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Mailbox not found' })
  findOne(@Param('id') id: string) {
    return this.mailboxesService.findOne(id);
  }

  @Get(':id/config')
  @ApiOperation({ summary: 'Get safe connection configuration for editing' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Safe configuration retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Mailbox not found' })
  getConnectionConfig(@Param('id') id: string) {
    return this.mailboxesService.getSafeConnectionConfig(id);
  }

  @Get(':id/warmup')
  @ApiOperation({ summary: 'Get warmup plan for a specific mailbox' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Warmup plan retrieved' })
  getWarmupPlan(@Param('id') id: string) {
    return this.mailboxesService.getWarmupPlan(id);
  }

  @Patch(':id/warmup')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update warmup plan for a specific mailbox' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Warmup plan updated' })
  updateWarmupPlan(@Param('id') id: string, @Body() body: any) {
    return this.mailboxesService.updateWarmupPlan(id, body);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update mailbox sending limits or state' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Mailbox updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Mailbox not found' })
  update(@Param('id') id: string, @Body() dto: UpdateMailboxDto) {
    return this.mailboxesService.update(id, dto);
  }

  @Post(':id/test-connection')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Test mailbox SMTP/OAuth connection' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Connection tested' })
  testConnection(@Param('id') id: string) {
    return this.mailboxesService.testConnection(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Disconnect and delete a mailbox' })
  @ApiParam({ name: 'id', description: 'Mailbox UUID' })
  @ApiResponse({ status: 200, description: 'Mailbox deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Mailbox not found' })
  remove(@Param('id') id: string) {
    return this.mailboxesService.remove(id);
  }
}

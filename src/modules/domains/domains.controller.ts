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
import { DomainsService } from './domains.service';
import { CreateDomainDto, UpdateDomainDto } from './dto/domain.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Domains')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('domains')
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Register a new sending domain' })
  @ApiResponse({ status: 201, description: 'Domain registered successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateDomainDto) {
    return this.domainsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all sending domains with verification statuses' })
  @ApiResponse({ status: 200, description: 'Sending domains retrieved successfully' })
  findAll() {
    return this.domainsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get domain details and attached mailboxes' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  findOne(@Param('id') id: string) {
    return this.domainsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update domain settings' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  update(@Param('id') id: string, @Body() dto: UpdateDomainDto) {
    return this.domainsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a sending domain' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  remove(@Param('id') id: string) {
    return this.domainsService.remove(id);
  }

  @Post(':id/verify-dns')
  @ApiOperation({ summary: 'Trigger on-demand DNS audit for SPF, DKIM, DMARC, MX, and CTD' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({
    status: 200,
    description: 'DNS audit executed successfully; returns individual record validity states and overall health score',
  })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  verifyDns(@Param('id') id: string) {
    return this.domainsService.verifyDns(id);
  }
}

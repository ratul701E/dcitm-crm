import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { SuppressionService } from './suppression.service';
import {
  CreateSuppressionDto,
  BulkSuppressionDto,
} from './dto/suppression.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Suppression & Compliance')
@Controller('suppression')
export class SuppressionController {
  constructor(private readonly suppressionService: SuppressionService) {}

  @Post()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Add an email address or wildcard domain (@domain.com) to suppression' })
  @ApiResponse({ status: 201, description: 'Suppression rule added successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  addSuppression(@Body() dto: CreateSuppressionDto) {
    return this.suppressionService.addSuppression(dto);
  }

  @Post('bulk')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Bulk add suppression rules or DNC list' })
  @ApiResponse({ status: 201, description: 'Bulk suppressions added successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  addBulk(@Body() dto: BulkSuppressionDto) {
    return this.suppressionService.addBulkSuppression(dto);
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'List suppressed emails and domains' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search filter for value' })
  @ApiResponse({ status: 200, description: 'Paginated suppression rules retrieved successfully' })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.suppressionService.findAll(page, limit, search);
  }

  @Delete(':id')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove an entry from the suppression list' })
  @ApiParam({ name: 'id', description: 'Suppression Rule UUID' })
  @ApiResponse({ status: 200, description: 'Suppression rule deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Suppression rule not found' })
  remove(@Param('id') id: string) {
    return this.suppressionService.remove(id);
  }

  @Get('unsubscribe')
  @ApiOperation({ summary: 'Public unsubscribe endpoint for email footer links (RFC 8058 compliant)' })
  @ApiQuery({ name: 'token', required: true, type: String, description: 'One-click unsubscribe secure cryptographic token' })
  @ApiResponse({ status: 200, description: 'Unsubscribe action processed and lead suppressed' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  unsubscribe(@Query('token') token: string) {
    return this.suppressionService.handleUnsubscribe(token);
  }
}

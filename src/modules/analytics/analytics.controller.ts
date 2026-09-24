import {
  Controller,
  Get,
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
  ApiResponse,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get global analytics overview' })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30 })
  getOverview(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.analyticsService.getOverview(days);
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Get daily analytics breakdown timeline' })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 14 })
  getTimeline(@Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number) {
    return this.analyticsService.getTimeline(days);
  }

  @Get('by-campaign')
  @ApiOperation({ summary: 'Get performance grouped by campaign' })
  getByCampaign() {
    return this.analyticsService.getByCampaign();
  }

  @Get('by-provider')
  @ApiOperation({ summary: 'Get volume grouped by email provider' })
  getByProvider() {
    return this.analyticsService.getByProvider();
  }
}

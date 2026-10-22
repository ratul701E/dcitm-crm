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
import { SequencesService } from './sequences.service';
import { CreateStepDto, UpdateStepDto, ReorderStepsDto } from './dto/sequence.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Campaign Sequences & Steps')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sequences')
export class SequencesController {
  constructor(private readonly sequencesService: SequencesService) {}

  @Get('campaign/:campaignId')
  @ApiOperation({ summary: 'Get full sequence and steps for a campaign' })
  @ApiParam({ name: 'campaignId', description: 'Associated Campaign UUID' })
  @ApiResponse({ status: 200, description: 'Sequence tree with ordered steps and variants retrieved' })
  @ApiResponse({ status: 404, description: 'Sequence or campaign not found' })
  getSequenceByCampaign(@Param('campaignId') campaignId: string) {
    return this.sequencesService.getSequenceByCampaign(campaignId);
  }

  @Post('campaign/:campaignId/steps')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Add a new sequence step with A/B variants' })
  @ApiParam({ name: 'campaignId', description: 'Associated Campaign UUID' })
  @ApiResponse({ status: 201, description: 'Sequence step and variants created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Campaign sequence not found' })
  addStep(
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateStepDto,
  ) {
    return this.sequencesService.addStep(campaignId, dto);
  }

  @Post('campaign/:campaignId/reorder')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Reorder steps within a sequence' })
  @ApiParam({ name: 'campaignId', description: 'Associated Campaign UUID' })
  @ApiResponse({ status: 200, description: 'Steps reordered successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  reorderSteps(
    @Param('campaignId') campaignId: string,
    @Body() dto: ReorderStepsDto,
  ) {
    return this.sequencesService.reorderSteps(campaignId, dto.stepIds);
  }

  @Patch('steps/:stepId')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update step delays or copy variants' })
  @ApiParam({ name: 'stepId', description: 'Sequence Step UUID' })
  @ApiResponse({ status: 200, description: 'Step updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Step not found' })
  updateStep(
    @Param('stepId') stepId: string,
    @Body() dto: UpdateStepDto,
  ) {
    return this.sequencesService.updateStep(stepId, dto);
  }

  @Delete('steps/:stepId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a sequence step' })
  @ApiParam({ name: 'stepId', description: 'Sequence Step UUID' })
  @ApiResponse({ status: 200, description: 'Step deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Step not found' })
  deleteStep(@Param('stepId') stepId: string) {
    return this.sequencesService.deleteStep(stepId);
  }
}

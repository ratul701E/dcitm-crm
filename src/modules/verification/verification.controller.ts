import {
  Controller,
  Post,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { VerificationQueueService } from './verification-queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Lead Verification')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationQueueService,
  ) {}

  @Post('lead/:id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Queue background verification for a single lead' })
  @ApiParam({ name: 'id', description: 'Lead UUID to verify' })
  @ApiResponse({ status: 201, description: 'Single lead verification job queued' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  verifySingle(@Param('id') id: string) {
    return this.verificationService.queueLeadVerification(id);
  }

  @Post('list/:listId')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Queue batch background verification for an entire lead list' })
  @ApiParam({ name: 'listId', description: 'Lead List UUID to verify in batch' })
  @ApiResponse({ status: 201, description: 'Batch verification jobs dispatched to queue' })
  @ApiResponse({ status: 404, description: 'Lead list not found' })
  verifyBatch(@Param('listId') listId: string) {
    return this.verificationService.queueBatchVerification(listId);
  }
}

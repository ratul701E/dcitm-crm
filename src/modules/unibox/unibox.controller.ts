import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
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
import { UniboxService } from './unibox.service';
import { UpdateReplyCategoryDto, SendManualReplyDto } from './dto/unibox.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReplyCategory } from '@prisma/client';

@ApiTags('Unibox (Unified Inbox)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('unibox')
export class UniboxController {
  constructor(private readonly uniboxService: UniboxService) {}

  @Get('replies')
  @ApiOperation({ summary: 'List paginated inbound replies across all mailboxes' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'category', required: false, enum: ReplyCategory })
  @ApiQuery({ name: 'mailboxId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Inbound replies retrieved successfully' })
  getReplies(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('category') category?: ReplyCategory,
    @Query('mailboxId') mailboxId?: string,
  ) {
    return this.uniboxService.getReplies(page, limit, category, mailboxId);
  }

  @Get('replies/:id')
  @ApiOperation({ summary: 'Get full conversation thread history for a reply' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  @ApiResponse({ status: 200, description: 'Conversation thread history retrieved' })
  @ApiResponse({ status: 404, description: 'Reply not found' })
  getReplyThread(@Param('id') id: string) {
    return this.uniboxService.getReplyThread(id);
  }

  @Patch('replies/:id/category')
  @ApiOperation({ summary: 'Update sentiment/intent label (e.g. Interested, Unsubscribe)' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  @ApiResponse({ status: 200, description: 'Sentiment category updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Reply not found' })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateReplyCategoryDto,
  ) {
    return this.uniboxService.updateCategory(id, dto);
  }

  @Post('replies/:id/send-reply')
  @ApiOperation({ summary: 'Send a manual reply keeping RFC conversation threading intact' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  @ApiResponse({ status: 201, description: 'Manual reply dispatched via associated mailbox' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Reply not found' })
  sendManualReply(
    @Param('id') id: string,
    @Body() dto: SendManualReplyDto,
  ) {
    return this.uniboxService.sendManualReply(id, dto);
  }

  @Patch('replies/:id/read')
  @ApiOperation({ summary: 'Mark reply as read or unread' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  markRead(
    @Param('id') id: string,
    @Body() body: { isRead?: boolean },
  ) {
    return this.uniboxService.markRead(id, body?.isRead ?? true);
  }

  @Patch('replies/:id/star')
  @ApiOperation({ summary: 'Toggle starred status on reply' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  toggleStar(@Param('id') id: string) {
    return this.uniboxService.toggleStar(id);
  }

  @Patch('replies/:id/status')
  @ApiOperation({ summary: 'Update thread status (active, archived, resolved)' })
  @ApiParam({ name: 'id', description: 'Inbound Reply UUID' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.uniboxService.updateStatus(id, body?.status || 'active');
  }
}

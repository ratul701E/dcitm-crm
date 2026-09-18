import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ReplyCategory } from '@prisma/client';

export const UpdateReplyCategorySchema = z.object({
  category: z
    .nativeEnum(ReplyCategory)
    .describe('Reply sentiment categorization label (INTERESTED, MEETING_BOOKED, NOT_INTERESTED, OUT_OF_OFFICE, WRONG_PERSON, UNSUBSCRIBE, UNCATEGORIZED)'),
});

export class UpdateReplyCategoryDto extends createZodDto(UpdateReplyCategorySchema) {}

export const SendManualReplySchema = z.object({
  htmlBody: z.string().min(1, 'htmlBody is required').describe('HTML message body content'),
  subject: z.string().optional().describe('Optional subject line override'),
});

export class SendManualReplyDto extends createZodDto(SendManualReplySchema) {}

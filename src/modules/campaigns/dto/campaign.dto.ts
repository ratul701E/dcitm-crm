import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CampaignStatus } from '@prisma/client';

const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const CreateCampaignSchema = z.object({
  title: z.string().min(1, 'Title is required').describe('Campaign title'),
  targetTimezone: z
    .string()
    .default('UTC')
    .optional()
    .describe('Target IANA timezone (e.g. America/New_York)'),
  dailyWindowStart: z
    .string()
    .regex(timeFormatRegex, 'dailyWindowStart must be in HH:mm format')
    .default('09:00')
    .optional()
    .describe('Daily sending start time (HH:mm)'),
  dailyWindowEnd: z
    .string()
    .regex(timeFormatRegex, 'dailyWindowEnd must be in HH:mm format')
    .default('17:00')
    .optional()
    .describe('Daily sending end time (HH:mm)'),
  activeDays: z
    .array(z.number().int().min(1).max(7))
    .default([1, 2, 3, 4, 5])
    .optional()
    .describe('Active days of week (1=Mon, 7=Sun)'),
  maxNewLeadsPerDay: z
    .number()
    .int()
    .min(1)
    .default(50)
    .optional()
    .describe('Maximum new leads contacted per day'),
  trackOpens: z
    .boolean()
    .default(true)
    .optional()
    .describe('Enable open tracking via tracking pixel'),
  trackClicks: z
    .boolean()
    .default(true)
    .optional()
    .describe('Enable click tracking via redirect proxy'),
  mailboxIds: z
    .array(z.string())
    .optional()
    .describe('Array of attached mailbox UUIDs'),
  leadListIds: z
    .array(z.string())
    .optional()
    .describe('Array of enrolled lead list UUIDs'),
});

export class CreateCampaignDto extends createZodDto(CreateCampaignSchema) {}

export const UpdateCampaignSchema = z.object({
  title: z.string().min(1).optional().describe('Updated campaign title'),
  status: z
    .nativeEnum(CampaignStatus)
    .optional()
    .describe('Campaign state'),
  targetTimezone: z.string().optional().describe('Target IANA timezone'),
  dailyWindowStart: z
    .string()
    .regex(timeFormatRegex, 'dailyWindowStart must be in HH:mm format')
    .optional()
    .describe('Daily sending start time (HH:mm)'),
  dailyWindowEnd: z
    .string()
    .regex(timeFormatRegex, 'dailyWindowEnd must be in HH:mm format')
    .optional()
    .describe('Daily sending end time (HH:mm)'),
  activeDays: z
    .array(z.number().int().min(1).max(7))
    .optional()
    .describe('Active days of week (1=Mon, 7=Sun)'),
  maxNewLeadsPerDay: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum new leads contacted per day'),
  trackOpens: z.boolean().optional().describe('Enable open tracking'),
  trackClicks: z.boolean().optional().describe('Enable click tracking'),
  mailboxIds: z
    .array(z.string())
    .optional()
    .describe('Array of attached mailbox UUIDs'),
  leadListIds: z
    .array(z.string())
    .optional()
    .describe('Array of enrolled lead list UUIDs'),
});

export class UpdateCampaignDto extends createZodDto(UpdateCampaignSchema) {}

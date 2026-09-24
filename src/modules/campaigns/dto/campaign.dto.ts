import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CampaignStatus, DelayMode } from '@prisma/client';

const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const CreateCampaignSchema = z
  .object({
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
    hourlyLimit: z
      .number()
      .int()
      .min(1)
      .default(10)
      .optional()
      .describe('Maximum allowed emails sent per hour per mailbox'),
    // Sending Delay & Randomization
    delayMode: z
      .nativeEnum(DelayMode)
      .default(DelayMode.WEIGHTED_RANDOM)
      .optional()
      .describe('Delay randomization mode (FIXED, UNIFORM_RANDOM, WEIGHTED_RANDOM, NATURAL)'),
    minimumDelaySeconds: z
      .number()
      .int()
      .min(0, 'Minimum delay must be an integer >= 0')
      .default(10)
      .optional()
      .describe('Minimum delay in seconds between consecutive emails'),
    maximumDelaySeconds: z
      .number()
      .int()
      .min(0, 'Maximum delay must be an integer >= 0')
      .nullable()
      .optional()
      .describe('Maximum delay in seconds. If omitted, defaults to minimum * 3'),
    randomSeed: z
      .string()
      .nullable()
      .optional()
      .describe('Seeded PRNG unique seed. Auto-generated if omitted'),
    minDelaySeconds: z
      .number()
      .int()
      .min(0)
      .default(45)
      .optional()
      .describe('Legacy alias for minimumDelaySeconds'),
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
    campaignType: z.string().default('outreach').optional().describe('Campaign archetype'),
    tags: z.array(z.string()).default([]).optional().describe('Filter tags'),
    scheduledFor: z.string().optional().nullable().describe('Scheduled start date'),
    replyToEmail: z.string().email().optional().or(z.literal('')).nullable().describe('Custom reply-to address'),
    excludedLeadListIds: z.array(z.string()).default([]).optional().describe('Excluded lead lists'),
    retryOnSoftBounce: z.boolean().default(true).optional().describe('Retry soft bounced emails'),
    unsubscribeLinkEnabled: z.boolean().default(true).optional().describe('Append unsubscribe footer'),
    status: z
      .nativeEnum(CampaignStatus)
      .default(CampaignStatus.DRAFT)
      .optional()
      .describe('Initial campaign status'),
    mailboxIds: z
      .array(z.string())
      .optional()
      .describe('Array of attached mailbox UUIDs'),
    leadListIds: z
      .array(z.string())
      .optional()
      .describe('Array of enrolled lead list UUIDs'),
    // Email content — persisted as sequence step + variant on creation
    subject: z.string().optional().describe('Email subject line for the first sequence step'),
    emailBody: z.string().optional().describe('HTML email body for the first sequence step'),
  })
  .refine(
    (data) => {
      const min = data.minimumDelaySeconds ?? data.minDelaySeconds ?? 10;
      if (data.maximumDelaySeconds !== null && data.maximumDelaySeconds !== undefined) {
        return data.maximumDelaySeconds >= min;
      }
      return true;
    },
    {
      message: 'Maximum delay seconds cannot be less than minimum delay seconds',
      path: ['maximumDelaySeconds'],
    },
  );

export class CreateCampaignDto extends createZodDto(CreateCampaignSchema) {}

export const SendTestEmailSchema = z.object({
  recipientEmail: z.string().email('Valid recipient email address is required').describe('Target recipient email'),
  subject: z.string().min(1, 'Subject line is required').describe('Email subject line'),
  bodyContent: z.string().min(1, 'Email body is required').describe('HTML email body'),
  senderName: z.string().optional().describe('Sender display name'),
  mailboxId: z.string().optional().nullable().describe('Mailbox UUID to send from'),
});

export class SendTestEmailDto extends createZodDto(SendTestEmailSchema) {}

export const UpdateCampaignSchema = z
  .object({
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
    hourlyLimit: z.number().int().min(1).optional().describe('Maximum allowed emails sent per hour'),
    delayMode: z.nativeEnum(DelayMode).optional().describe('Delay randomization mode'),
    minimumDelaySeconds: z.number().int().min(0).optional().describe('Minimum delay in seconds'),
    maximumDelaySeconds: z.number().int().min(0).nullable().optional().describe('Maximum delay in seconds'),
    randomSeed: z.string().nullable().optional().describe('PRNG seed'),
    minDelaySeconds: z.number().int().min(0).optional().describe('Legacy alias for minimumDelaySeconds'),
    trackOpens: z.boolean().optional().describe('Enable open tracking'),
    trackClicks: z.boolean().optional().describe('Enable click tracking'),
    campaignType: z.string().optional().describe('Campaign archetype'),
    tags: z.array(z.string()).optional().describe('Filter tags'),
    scheduledFor: z.string().optional().nullable().describe('Scheduled start date'),
    replyToEmail: z.string().email().optional().or(z.literal('')).nullable().describe('Custom reply-to address'),
    excludedLeadListIds: z.array(z.string()).optional().describe('Excluded lead lists'),
    retryOnSoftBounce: z.boolean().optional().describe('Retry soft bounced emails'),
    unsubscribeLinkEnabled: z.boolean().optional().describe('Append unsubscribe footer'),
    mailboxIds: z
      .array(z.string())
      .optional()
      .describe('Array of attached mailbox UUIDs'),
    leadListIds: z
      .array(z.string())
      .optional()
      .describe('Array of enrolled lead list UUIDs'),
  })
  .refine(
    (data) => {
      if (
        data.minimumDelaySeconds !== undefined &&
        data.maximumDelaySeconds !== undefined &&
        data.maximumDelaySeconds !== null
      ) {
        return data.maximumDelaySeconds >= data.minimumDelaySeconds;
      }
      return true;
    },
    {
      message: 'Maximum delay seconds cannot be less than minimum delay seconds',
      path: ['maximumDelaySeconds'],
    },
  );

export class UpdateCampaignDto extends createZodDto(UpdateCampaignSchema) {}

export const PreviewDelaysSchema = z
  .object({
    mode: z.nativeEnum(DelayMode).default(DelayMode.WEIGHTED_RANDOM).optional(),
    minimumDelaySeconds: z.number().int().min(0).default(10).optional(),
    maximumDelaySeconds: z.number().int().min(0).nullable().optional(),
    count: z.number().int().min(1).max(50).default(10).optional(),
    seed: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      const min = data.minimumDelaySeconds ?? 10;
      if (data.maximumDelaySeconds !== null && data.maximumDelaySeconds !== undefined) {
        return data.maximumDelaySeconds >= min;
      }
      return true;
    },
    {
      message: 'Maximum delay seconds cannot be less than minimum delay seconds',
      path: ['maximumDelaySeconds'],
    },
  );

export class PreviewDelaysDto extends createZodDto(PreviewDelaysSchema) {}

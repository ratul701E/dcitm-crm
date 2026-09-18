import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LeadStatus, LeadVerificationStatus } from '@prisma/client';

export const CreateLeadListSchema = z.object({
  name: z.string().min(1, 'List name is required').describe('Lead list name'),
  description: z
    .string()
    .optional()
    .describe('Description or campaign target context'),
});

export class CreateLeadListDto extends createZodDto(CreateLeadListSchema) {}

export const CreateLeadSchema = z.object({
  email: z.string().email('Invalid email format').describe('Lead corporate email'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  company: z.string().optional().describe('Company or organization name'),
  jobTitle: z.string().optional().describe('Job title or role'),
  website: z.string().optional().describe('Company website or homepage URL'),
  linkedIn: z.string().optional().describe('LinkedIn profile URL'),
  city: z.string().optional().describe('City of residence'),
  country: z.string().optional().describe('Country code or name'),
  customVariables: z
    .record(z.string(), z.any())
    .optional()
    .describe('Dynamic spintax / merge variables JSON dictionary'),
});

export class CreateLeadDto extends createZodDto(CreateLeadSchema) {}

export const UpdateLeadSchema = z.object({
  status: z
    .nativeEnum(LeadStatus)
    .optional()
    .describe('Outreach lifecycle status'),
  verificationStatus: z
    .nativeEnum(LeadVerificationStatus)
    .optional()
    .describe('Email verification deliverability state'),
  customVariables: z
    .record(z.string(), z.any())
    .optional()
    .describe('Custom merge variables JSON dictionary'),
});

export class UpdateLeadDto extends createZodDto(UpdateLeadSchema) {}

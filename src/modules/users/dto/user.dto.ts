import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

export const InviteUserSchema = z.object({
  email: z.string().email('Valid email is required').describe('User email address'),
  name: z.string().optional().describe('Full name (optional)'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  role: z.nativeEnum(UserRole).default(UserRole.MEMBER).optional().describe('Role to assign'),
});

export class InviteUserDto extends createZodDto(InviteUserSchema) {}

export const UpdateUserSchema = z.object({
  role: z.nativeEnum(UserRole).optional().describe('User role'),
  isActive: z.boolean().optional().describe('Active status'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
});

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}

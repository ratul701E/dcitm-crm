import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email().describe('User corporate email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .describe('Secure password (min 8 chars)'),
  firstName: z.string().min(1, 'First name is required').describe('First name'),
  lastName: z.string().min(1, 'Last name is required').describe('Last name'),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}

export const LoginSchema = z.object({
  email: z.string().email().describe('User email address'),
  password: z.string().min(1, 'Password is required').describe('User password'),
});

export class LoginDto extends createZodDto(LoginSchema) {}

export const RefreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required')
    .describe('The long-lived refresh token'),
});

export class RefreshTokenDto extends createZodDto(RefreshTokenSchema) {}

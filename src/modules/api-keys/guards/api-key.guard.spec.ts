import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import { MailboxState } from '@prisma/client';
import * as crypto from 'crypto';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  const createMockContext = (headers: Record<string, string>): any => {
    const request: any = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
  };

  it('should throw UnauthorizedException when header is missing', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should authenticate valid API key from X-API-Key header and attach entities', async () => {
    const rawKey = 'crm_live_1234567890abcdef12345678';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const mockApiKey = {
      id: 'key-1',
      keyHash,
      isActive: true,
      mailbox: {
        id: 'mb-1',
        email: 'test@domain.com',
        state: MailboxState.ACTIVE,
      },
    };

    prisma.apiKey.findUnique.mockResolvedValue(mockApiKey);

    const context = createMockContext({ 'x-api-key': rawKey });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest();
    expect(req.apiKey).toBe(mockApiKey);
    expect(req.mailbox).toBe(mockApiKey.mailbox);
  });

  it('should throw UnauthorizedException if API key is deactivated', async () => {
    const rawKey = 'crm_live_deactivated_key';
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-2',
      isActive: false,
    });

    const context = createMockContext({ 'x-api-key': rawKey });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if API key is expired', async () => {
    const rawKey = 'crm_live_expired_key';
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-3',
      isActive: true,
      expiresAt: new Date(Date.now() - 10000), // in the past
    });

    const context = createMockContext({ 'x-api-key': rawKey });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if mailbox is in AUTH_FAILED state', async () => {
    const rawKey = 'crm_live_valid_key';
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-4',
      isActive: true,
      mailbox: {
        id: 'mb-1',
        state: MailboxState.AUTH_FAILED,
      },
    });

    const context = createMockContext({ 'x-api-key': rawKey });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});


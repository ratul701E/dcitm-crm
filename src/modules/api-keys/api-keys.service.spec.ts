jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProviderAdaptersService } from '../dispatcher/provider-adapters.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { MailboxState, MailboxType, EmailDispatchStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: any;
  let mailboxesService: any;
  let adapters: any;
  let auditService: any;

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      mailbox: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      transactionalEmailLog: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    mailboxesService = {
      getDecryptedConfig: jest.fn(),
    };

    adapters = {
      dispatch: jest.fn(),
    };

    auditService = {
      log: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailboxesService, useValue: mailboxesService },
        { provide: ProviderAdaptersService, useValue: adapters },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  describe('create', () => {
    it('should generate an API key with crm_live_ prefix, hash it, and return plaintext once', async () => {
      const mockMailbox = {
        id: 'mb-123',
        email: 'outreach@example.com',
        state: MailboxState.ACTIVE,
        type: MailboxType.SMTP_IMAP,
      };
      prisma.mailbox.findUnique.mockResolvedValue(mockMailbox);

      prisma.apiKey.create.mockImplementation(({ data }: any) => {
        return Promise.resolve({
          id: 'key-123',
          ...data,
          createdAt: new Date(),
          mailbox: mockMailbox,
        });
      });

      const result = await service.create(
        {
          name: 'Shopify Webhook Key',
          mailboxId: 'mb-123',
          rateLimitPerHour: 200,
        },
        'user-admin-1',
      );

      expect(result.id).toBe('key-123');
      expect(result.name).toBe('Shopify Webhook Key');
      expect(result.key).toMatch(/^crm_live_[a-f0-9]{48}$/);
      expect(result.keyPrefix).toMatch(/^crm_live_\.\.\.[a-f0-9]{4}$/);
      expect(result.rateLimitPerHour).toBe(200);

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Shopify Webhook Key',
            mailboxId: 'mb-123',
            createdById: 'user-admin-1',
            rateLimitPerHour: 200,
          }),
        }),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'API_KEY_CREATED',
          targetEntity: 'ApiKey',
          targetId: 'key-123',
        }),
      );
    });

    it('should throw NotFoundException if mailbox does not exist', async () => {
      prisma.mailbox.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Key', mailboxId: 'non-existent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if mailbox is in AUTH_FAILED state', async () => {
      prisma.mailbox.findUnique.mockResolvedValue({
        id: 'mb-1',
        email: 'broken@example.com',
        state: MailboxState.AUTH_FAILED,
      });

      await expect(
        service.create({ name: 'Key', mailboxId: 'mb-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('toggleActive', () => {
    it('should toggle active status and create audit log', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        name: 'My Key',
        keyPrefix: 'crm_live_...1234',
        isActive: true,
      });

      prisma.apiKey.update.mockResolvedValue({
        id: 'key-1',
        isActive: false,
      });

      const result = await service.toggleActive('key-1', 'admin-1');
      expect(result.isActive).toBe(false);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'API_KEY_DEACTIVATED',
        }),
      );
    });
  });

  describe('remove', () => {
    it('should delete API key and create audit log', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        name: 'My Key',
        keyPrefix: 'crm_live_...1234',
      });
      prisma.apiKey.delete.mockResolvedValue({});

      const result = await service.remove('key-1', 'admin-1');
      expect(result.success).toBe(true);
      expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1' } });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'API_KEY_DELETED',
        }),
      );
    });
  });

  describe('sendEmail', () => {
    const mockMailbox = {
      id: 'mb-1',
      email: 'sender@example.com',
      senderName: 'CRM Bot',
      type: MailboxType.SMTP_IMAP,
      state: MailboxState.ACTIVE,
      sentCountToday: 5,
      dailySendingLimit: 100,
    };

    const mockApiKey = {
      id: 'key-1',
      rateLimitPerHour: 50,
    };

    it('should successfully dispatch email via provider adapter and log transaction', async () => {
      prisma.transactionalEmailLog.count.mockResolvedValue(2);
      mailboxesService.getDecryptedConfig.mockResolvedValue({ smtpHost: 'smtp.mail.com' });
      adapters.dispatch.mockResolvedValue({ success: true, messageId: 'msg-abc-123' });

      prisma.transactionalEmailLog.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'log-1', ...data, sentAt: new Date() }),
      );
      prisma.mailbox.update.mockResolvedValue({});

      const result = await service.sendEmail(mockMailbox, mockApiKey, {
        to: 'customer@example.com',
        subject: 'Hello World',
        html: '<p>Test email</p>',
      });

      expect(result.success).toBe(true);
      expect(result.to).toBe('customer@example.com');
      expect(adapters.dispatch).toHaveBeenCalledWith(
        MailboxType.SMTP_IMAP,
        { smtpHost: 'smtp.mail.com' },
        expect.objectContaining({
          to: 'customer@example.com',
          from: '"CRM Bot" <sender@example.com>',
          subject: 'Hello World',
          html: '<p>Test email</p>',
        }),
      );

      expect(prisma.transactionalEmailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKeyId: 'key-1',
            mailboxId: 'mb-1',
            status: EmailDispatchStatus.SENT,
          }),
        }),
      );

      expect(prisma.mailbox.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mb-1' },
          data: expect.objectContaining({
            sentCountToday: { increment: 1 },
          }),
        }),
      );
    });

    it('should throw 429 when daily sending limit is reached', async () => {
      const exhaustedMailbox = {
        ...mockMailbox,
        sentCountToday: 100,
        dailySendingLimit: 100,
      };

      await expect(
        service.sendEmail(exhaustedMailbox, mockApiKey, {
          to: 'customer@example.com',
          subject: 'Test',
          text: 'Hello',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw 429 when API key hourly rate limit is exceeded', async () => {
      prisma.transactionalEmailLog.count.mockResolvedValue(50); // limit is 50

      await expect(
        service.sendEmail(mockMailbox, mockApiKey, {
          to: 'customer@example.com',
          subject: 'Test',
          text: 'Hello',
        }),
      ).rejects.toThrow(HttpException);
    });
  });
});

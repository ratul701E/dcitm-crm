jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysController } from './api-keys.controller';
import { MailSendController } from './mail-send.controller';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ApiKeysController & MailSendController', () => {
  let apiKeysController: ApiKeysController;
  let mailSendController: MailSendController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'key-1', name: 'Web Key' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'key-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'key-1' }),
      toggleActive: jest.fn().mockResolvedValue({ id: 'key-1', isActive: false }),
      update: jest.fn().mockResolvedValue({ id: 'key-1', name: 'Updated' }),
      remove: jest.fn().mockResolvedValue({ success: true }),
      sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
      getLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController, MailSendController],
      providers: [
        { provide: ApiKeysService, useValue: service },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    apiKeysController = module.get<ApiKeysController>(ApiKeysController);
    mailSendController = module.get<MailSendController>(MailSendController);
  });

  it('ApiKeysController.create delegates to service.create with user id', async () => {
    const dto = { name: 'New Key', mailboxId: 'mb-1', rateLimitPerHour: 100 };
    const res = await apiKeysController.create({ id: 'admin-1' }, dto as any);
    expect(res).toEqual({ id: 'key-1', name: 'Web Key' });
    expect(service.create).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('ApiKeysController.findAll delegates to service.findAll', async () => {
    const res = await apiKeysController.findAll();
    expect(res).toEqual([{ id: 'key-1' }]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('ApiKeysController.remove delegates to service.remove', async () => {
    const res = await apiKeysController.remove({ id: 'admin-1' }, 'key-1');
    expect(res).toEqual({ success: true });
    expect(service.remove).toHaveBeenCalledWith('key-1', 'admin-1');
  });

  it('MailSendController.sendEmail delegates to service.sendEmail with attached entities', async () => {
    const mockReq = {
      mailbox: { id: 'mb-1', email: 'sender@example.com' },
      apiKey: { id: 'key-1' },
    };
    const dto = {
      to: 'target@example.com',
      subject: 'Test Subject',
      html: '<p>Body</p>',
    };

    const res = await mailSendController.sendEmail(mockReq, dto as any);
    expect(res).toEqual({ success: true, messageId: 'msg-1' });
    expect(service.sendEmail).toHaveBeenCalledWith(mockReq.mailbox, mockReq.apiKey, dto);
  });
});

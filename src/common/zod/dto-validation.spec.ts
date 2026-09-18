import { RegisterSchema, LoginSchema } from '../../modules/auth/dto/auth.dto';
import { CreateCampaignSchema } from '../../modules/campaigns/dto/campaign.dto';
import { CreateDomainSchema } from '../../modules/domains/dto/domain.dto';
import { CreateLeadSchema } from '../../modules/leads/dto/lead.dto';
import { CreateMailboxSchema } from '../../modules/mailboxes/dto/mailbox.dto';
import { CreateStepSchema } from '../../modules/sequences/dto/sequence.dto';
import { CreateSuppressionSchema } from '../../modules/suppression/dto/suppression.dto';
import { UpdateReplyCategorySchema } from '../../modules/unibox/dto/unibox.dto';
import {
  MailboxType,
  ReplyCategory,
  SuppressionReason,
} from '@prisma/client';

describe('Zod Schema DTO Validation', () => {
  describe('Auth Schemas', () => {
    it('should validate correct Register payload', () => {
      const valid = {
        email: 'test@example.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
      };
      const parsed = RegisterSchema.parse(valid);
      expect(parsed.email).toBe('test@example.com');
    });

    it('should reject password shorter than 8 chars', () => {
      const invalid = {
        email: 'test@example.com',
        password: 'short',
        firstName: 'John',
        lastName: 'Doe',
      };
      expect(() => RegisterSchema.parse(invalid)).toThrow();
    });

    it('should reject invalid email', () => {
      const invalid = {
        email: 'not-an-email',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
      };
      expect(() => RegisterSchema.parse(invalid)).toThrow();
    });
  });

  describe('Campaign Schema', () => {
    it('should validate valid campaign and apply defaults', () => {
      const payload = {
        title: 'Q3 Outreach',
      };
      const parsed = CreateCampaignSchema.parse(payload);
      expect(parsed.targetTimezone).toBe('UTC');
      expect(parsed.dailyWindowStart).toBe('09:00');
      expect(parsed.dailyWindowEnd).toBe('17:00');
      expect(parsed.maxNewLeadsPerDay).toBe(50);
      expect(parsed.trackOpens).toBe(true);
    });

    it('should reject invalid time window format', () => {
      const payload = {
        title: 'Q3 Outreach',
        dailyWindowStart: '25:99',
      };
      expect(() => CreateCampaignSchema.parse(payload)).toThrow();
    });
  });

  describe('Domain Schema', () => {
    it('should accept valid domain', () => {
      const parsed = CreateDomainSchema.parse({
        name: 'cold.domain.com',
      });
      expect(parsed.dkimSelector).toBe('google');
    });

    it('should reject invalid redirect URL', () => {
      expect(() =>
        CreateDomainSchema.parse({
          name: 'cold.domain.com',
          redirectUrl: 'not-a-url',
        }),
      ).toThrow();
    });
  });

  describe('Mailbox Schema', () => {
    it('should validate SMTP_IMAP mailbox creation', () => {
      const payload = {
        email: 'sender@cold.domain.com',
        domainId: 'domain-123',
        type: MailboxType.SMTP_IMAP,
        dailySendingLimit: 60,
      };
      const parsed = CreateMailboxSchema.parse(payload);
      expect(parsed.type).toBe(MailboxType.SMTP_IMAP);
      expect(parsed.dailySendingLimit).toBe(60);
      expect(parsed.warmupDailyLimit).toBe(10);
      expect(parsed.minDelaySeconds).toBe(90);
    });
  });

  describe('Lead Schema', () => {
    it('should validate lead with custom variables', () => {
      const payload = {
        email: 'lead@company.com',
        firstName: 'Alice',
        customVariables: { role: 'CTO', teamSize: 20 },
      };
      const parsed = CreateLeadSchema.parse(payload);
      expect(parsed.email).toBe('lead@company.com');
      expect(parsed.customVariables?.role).toBe('CTO');
    });
  });

  describe('Sequence Step Schema', () => {
    it('should validate step with variants', () => {
      const payload = {
        stepOrder: 1,
        variants: [
          {
            variantKey: 'A',
            weight: 50,
            subject: 'Quick question',
            body: '<p>Hello {{firstName}}</p>',
          },
          {
            variantKey: 'B',
            weight: 50,
            subject: 'Reaching out',
            body: '<p>Hi {{firstName}}</p>',
          },
        ],
      };
      const parsed = CreateStepSchema.parse(payload);
      expect(parsed.variants).toHaveLength(2);
      expect(parsed.delayDays).toBe(3);
    });

    it('should reject step without variants', () => {
      const payload = {
        stepOrder: 1,
        variants: [],
      };
      expect(() => CreateStepSchema.parse(payload)).toThrow();
    });
  });

  describe('Suppression & Unibox Schemas', () => {
    it('should validate suppression payload', () => {
      const parsed = CreateSuppressionSchema.parse({
        value: '@competitor.com',
        reason: SuppressionReason.MANUAL_DNC,
      });
      expect(parsed.reason).toBe(SuppressionReason.MANUAL_DNC);
    });

    it('should validate reply category update', () => {
      const parsed = UpdateReplyCategorySchema.parse({
        category: ReplyCategory.INTERESTED,
      });
      expect(parsed.category).toBe(ReplyCategory.INTERESTED);
    });
  });
});

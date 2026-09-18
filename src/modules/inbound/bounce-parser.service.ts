import { Injectable, Logger } from '@nestjs/common';
import { SuppressionService } from '../suppression/suppression.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppressionReason, LeadStatus, EmailDispatchStatus } from '@prisma/client';

export interface BounceClassification {
  isBounce: boolean;
  isHardBounce: boolean;
  statusCode?: string;
  diagnosticCode?: string;
  recipientEmail?: string;
}

@Injectable()
export class BounceParserService {
  private readonly logger = new Logger(BounceParserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppressionService: SuppressionService,
  ) {}

  /**
   * Inspects parsed email body and headers to detect DSN / NDR bounce reports
   */
  classifyBounce(
    subject: string,
    body: string,
    headers: Map<string, any>,
  ): BounceClassification {
    const cleanSubject = (subject || '').toLowerCase();
    const cleanBody = (body || '').toLowerCase();

    // Subject cues
    const bounceSubjectKeywords = [
      'delivery status notification',
      'undeliverable',
      'mail delivery failed',
      'returned mail',
      'failure notice',
      'delivery failure',
      'action: failed',
    ];

    const isBounceSubject = bounceSubjectKeywords.some((k) =>
      cleanSubject.includes(k),
    );

    if (!isBounceSubject && !cleanBody.includes('status: 5.') && !cleanBody.includes('status: 4.')) {
      return { isBounce: false, isHardBounce: false };
    }

    // Extract SMTP status codes (e.g. 5.1.1, 5.2.0, 4.4.1)
    const statusMatch = cleanBody.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/);
    const statusCode = statusMatch ? statusMatch[1] : undefined;

    // Hard bounce = 5xx status codes or permanent failure keywords
    const isHardBounce =
      (statusCode && statusCode.startsWith('5.')) ||
      cleanBody.includes('does not exist') ||
      cleanBody.includes('user unknown') ||
      cleanBody.includes('mailbox not found') ||
      cleanBody.includes('permanent error');

    // Extract failed recipient email
    const emailMatch = cleanBody.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    const recipientEmail = emailMatch ? emailMatch[0].toLowerCase() : undefined;

    return {
      isBounce: true,
      isHardBounce: !!isHardBounce,
      statusCode,
      diagnosticCode: cleanSubject,
      recipientEmail,
    };
  }

  /**
   * Handles bounce events: updates Lead & EmailLog status, pushes hard bounces to Suppression
   */
  async processBounceEvent(
    bounce: BounceClassification,
    associatedEmailLogId?: string,
  ) {
    if (!bounce.isBounce) return;

    let emailLog = associatedEmailLogId
      ? await this.prisma.emailLog.findUnique({
          where: { id: associatedEmailLogId },
        })
      : null;

    // If logId wasn't passed directly, attempt lookup by recipient email
    if (!emailLog && bounce.recipientEmail) {
      emailLog = await this.prisma.emailLog.findFirst({
        where: {
          lead: { email: bounce.recipientEmail },
          status: EmailDispatchStatus.SENT,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!emailLog) return;

    if (bounce.isHardBounce) {
      this.logger.warn(
        `Hard bounce detected for ${bounce.recipientEmail || emailLog.leadId}. Quarantining to suppression.`,
      );

      // Update EmailLog
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: EmailDispatchStatus.BOUNCED,
          bounceReason: bounce.diagnosticCode || `Hard bounce (code: ${bounce.statusCode})`,
        },
      });

      // Update Lead state to BOUNCED
      const lead = await this.prisma.lead.update({
        where: { id: emailLog.leadId },
        data: {
          status: LeadStatus.BOUNCED,
          nextScheduledAt: null, // Halt sequence
        },
      });

      // Auto-push directly to Suppression
      await this.suppressionService.addSuppression({
        value: lead.email,
        reason: SuppressionReason.HARD_BOUNCE,
        source: 'bounce_handler',
      });
    } else {
      // Soft bounce handling: retry up to 2 times
      this.logger.log(`Soft bounce detected for lead ${emailLog.leadId}`);
      const retryCount = emailLog.retryCount + 1;

      if (retryCount <= 2) {
        // Backoff: 12h for attempt 1, 24h for attempt 2
        const delayHours = retryCount === 1 ? 12 : 24;
        const retryDate = new Date(Date.now() + delayHours * 60 * 60 * 1000);

        await this.prisma.emailLog.update({
          where: { id: emailLog.id },
          data: {
            retryCount,
            bounceReason: `Soft bounce retry ${retryCount}/2 (status: ${bounce.statusCode})`,
          },
        });

        await this.prisma.lead.update({
          where: { id: emailLog.leadId },
          data: {
            status: LeadStatus.SOFT_BOUNCED,
            nextScheduledAt: retryDate,
          },
        });
      } else {
        // Max retries exceeded
        await this.prisma.emailLog.update({
          where: { id: emailLog.id },
          data: {
            status: EmailDispatchStatus.FAILED,
            bounceReason: `Soft bounce exceeded 2 retries`,
          },
        });

        await this.prisma.lead.update({
          where: { id: emailLog.leadId },
          data: {
            status: LeadStatus.BOUNCED,
            nextScheduledAt: null,
          },
        });
      }
    }
  }
}

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { VerificationProviderService } from './verification-provider.service';
import { SuppressionService } from '../suppression/suppression.service';
import { LeadVerificationStatus, SuppressionReason } from '@prisma/client';

@Injectable()
export class VerificationQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VerificationQueueService.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly provider: VerificationProviderService,
    private readonly suppressionService: SuppressionService,
  ) {}

  onModuleInit() {
    const connection: any = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      username: this.configService.get<string>('REDIS_USERNAME') || undefined,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
    };

    this.queue = new Queue('lead-verification-queue', { connection });
    this.queue.on('error', (err) => {
      this.logger.warn(`Redis queue connection warning: ${err.message}`);
    });

    this.worker = new Worker(
      'lead-verification-queue',
      async (job: Job<{ leadId: string; email: string }>) => {
        const { leadId, email } = job.data;
        try {
          const result = await this.provider.verifyEmail(email);

          // Update lead status
          await this.prisma.lead.update({
            where: { id: leadId },
            data: { verificationStatus: result.status },
          });

          // If invalid or disposable, auto-quarantine into suppression repository
          if (
            result.status === LeadVerificationStatus.INVALID ||
            result.status === LeadVerificationStatus.DISPOSABLE
          ) {
            await this.suppressionService.addSuppression({
              value: email,
              reason:
                result.status === LeadVerificationStatus.DISPOSABLE
                  ? SuppressionReason.DISPOSABLE_EMAIL
                  : SuppressionReason.INVALID_EMAIL,
              source: 'verification_provider_quarantine',
            });
          }
        } catch (err: any) {
          this.logger.error(`Verification job failed for ${email}: ${err.message}`);
        }
      },
      {
        connection,
        concurrency: 2,
      },
    );
    this.worker.on('error', (err) => {
      this.logger.warn(`Redis worker connection warning: ${err.message}`);
    });
  }

  async queueLeadVerification(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    await this.queue.add('verify-single', { leadId: lead.id, email: lead.email });
    return { queued: true, leadId: lead.id };
  }

  async queueBatchVerification(leadListId: string) {
    const leads = await this.prisma.lead.findMany({
      where: {
        leadListId,
        verificationStatus: LeadVerificationStatus.UNVERIFIED,
      },
      select: { id: true, email: true },
    });

    for (const lead of leads) {
      await this.queue.add('verify-batch', { leadId: lead.id, email: lead.email });
    }

    return { queued: true, count: leads.length };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

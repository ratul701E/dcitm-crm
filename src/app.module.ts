import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { VaultModule } from './common/vault/vault.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { DomainsModule } from './modules/domains/domains.module';
import { MailboxesModule } from './modules/mailboxes/mailboxes.module';
import { LeadsModule } from './modules/leads/leads.module';
import { SuppressionModule } from './modules/suppression/suppression.module';
import { VerificationModule } from './modules/verification/verification.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { SpintaxModule } from './modules/spintax/spintax.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { DispatcherModule } from './modules/dispatcher/dispatcher.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { InboundModule } from './modules/inbound/inbound.module';
import { UniboxModule } from './modules/unibox/unibox.module';
import { UsersModule } from './modules/users/users.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { SegmentsModule } from './modules/segments/segments.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SearchModule } from './modules/search/search.module';
import { CategoriesModule } from './modules/categories/categories.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    RedisModule,
    VaultModule,
    AuditModule,
    HealthModule,
    AuthModule,
    DomainsModule,
    MailboxesModule,
    LeadsModule,
    SuppressionModule,
    VerificationModule,
    CampaignsModule,
    SequencesModule,
    SpintaxModule,
    TrackingModule,
    DispatcherModule,
    SchedulerModule,
    InboundModule,
    UniboxModule,
    UsersModule,
    TemplatesModule,
    SegmentsModule,
    AnalyticsModule,
    DashboardModule,
    SearchModule,
    CategoriesModule,
  ],
})
export class AppModule {}

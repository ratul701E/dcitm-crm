import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  process.on('unhandledRejection', (reason: any) => {
    logger.error(`Unhandled Promise Rejection: ${reason?.message || reason}`, reason?.stack);
  });

  // Support Chrome Private Network Access (PNA) for loopback calls from public tunnels
  app.use((req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
  });

  // CORS — allow frontend dev servers (localhost on any port) and configured origins
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (server-to-server, curl, Swagger, mobile apps)
      if (!origin) return callback(null, true);

      // Allow any localhost or 127.0.0.1 port (e.g., 3001, 5173, etc.) and ngrok tunnels
      if (
        /^http:\/\/localhost(:\d+)?$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        origin.includes('canonistic-salley-uncut.ngrok-free.dev') ||
        /\.ngrok-free\.(app|dev)$/.test(origin)
      ) {
        return callback(null, true);
      }

      const configuredOrigin = configService.get<string>('CORS_ORIGIN', '');
      if (configuredOrigin) {
        const allowedList = configuredOrigin.split(',').map((s) => s.trim());
        if (configuredOrigin === '*' || allowedList.includes(origin)) {
          return callback(null, true);
        }
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
      'Access-Control-Request-Private-Network',
    ],
  });

  // Global prefixes and pipes
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());

  // Global filters & interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseTransformInterceptor(),
  );

  // Swagger Documentation Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DCITM CRM Backend API')
    .setDescription(
      'Enterprise Cold-Outreach & Deliverability Infrastructure Engine. Includes multi-mailbox rotation, automated sequence scheduling, DNS health audits (SPF/DKIM/DMARC/MX), unified inbox sentiment labeling, and real-time bounce processing.',
    )
    .setVersion('1.0.0')
    .addTag('System', 'Base application ping and root endpoints')
    .addTag('Health & Readiness', 'Kubernetes liveness and readiness probe healthchecks')
    .addTag('Authentication', 'Team member registration, JWT access/refresh token rotation, and revocation')
    .addTag('Campaigns', 'Outreach campaign lifecycle, sending window configuration, and mailbox pools')
    .addTag('Campaign Sequences & Steps', 'Multi-step email cadences with weighted multi-variant A/B copy')
    .addTag('Domains', 'Sending domain management, tracking domain configuration, and DNS record audits')
    .addTag('Mailboxes', 'SMTP/IMAP & OAuth mailbox onboarding, warm-up pacing, and connection state')
    .addTag('Leads & Lists', 'Prospect lead lists, streaming CSV bulk imports, and metadata management')
    .addTag('Lead Verification', 'Multi-provider single and batch email validation worker queues')
    .addTag('Suppression & Compliance', 'Global suppression, manual DNC lists, and RFC 8058 one-click unsubscribes')
    .addTag('Tracking Proxy', 'Transparent 1x1 open pixels and redirect proxy click tracking')
    .addTag('Unibox (Unified Inbox)', 'Consolidated prospect replies, sentiment categorization, and RFC-threaded replies')
    .addTag('Admin Audit Logs', 'System activity trails, security events, and administrative audit logs')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter your JWT access token (e.g. from /api/auth/login)',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document), {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'DCITM CRM API Documentation',
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
  logger.log(`📚 Swagger documentation available at: http://localhost:${port}/api/docs`);
}
bootstrap();

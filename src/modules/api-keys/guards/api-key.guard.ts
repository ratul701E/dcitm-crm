import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailboxState } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = this.extractKeyFromRequest(request);

    if (!rawKey) {
      throw new UnauthorizedException(
        'Missing API key. Provide your key via the X-API-Key header or Authorization: Bearer <key>.',
      );
    }

    const keyHash = crypto.createHash('sha256').update(rawKey.trim()).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        mailbox: {
          include: {
            domain: true,
          },
        },
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (!apiKey.isActive) {
      throw new UnauthorizedException('This API key has been deactivated or revoked.');
    }

    if (apiKey.expiresAt && new Date() > new Date(apiKey.expiresAt)) {
      throw new UnauthorizedException('This API key has expired.');
    }

    if (!apiKey.mailbox) {
      throw new UnauthorizedException('The email account associated with this API key no longer exists.');
    }

    if (apiKey.mailbox.state === MailboxState.AUTH_FAILED) {
      throw new UnauthorizedException(
        'The email account associated with this API key requires re-authentication in the CRM.',
      );
    }

    // Attach validated entities to the request context
    request.apiKey = apiKey;
    request.mailbox = apiKey.mailbox;

    // Asynchronously update lastUsedAt without blocking request dispatch
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => {
        this.logger.warn(`Failed to update lastUsedAt for API key ${apiKey.id}: ${err.message}`);
      });

    return true;
  }

  private extractKeyFromRequest(request: any): string | null {
    const xApiKey = request.headers['x-api-key'] || request.headers['x-api-token'];
    if (xApiKey) {
      return Array.isArray(xApiKey) ? xApiKey[0] : xApiKey;
    }

    const authHeader = request.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.trim().split(' ');
      if (parts.length === 2 && (parts[0].toLowerCase() === 'bearer' || parts[0].toLowerCase() === 'apikey')) {
        return parts[1];
      }
      if (parts.length === 1 && parts[0].startsWith('crm_live_')) {
        return parts[0];
      }
    }

    return null;
  }
}


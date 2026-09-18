import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class UnsubscribeService {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'fallback_secret_for_unsubscribe';
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signed unsubscribe token
   */
  generateUnsubscribeToken(email: string, campaignId?: string): string {
    const payload = `${email.toLowerCase()}|${campaignId || 'all'}`;
    const hmac = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');
    const base64Payload = Buffer.from(payload).toString('base64url');
    return `${base64Payload}.${hmac}`;
  }

  /**
   * Verifies the HMAC-SHA256 signature of an unsubscribe token
   */
  verifyUnsubscribeToken(token: string): { email: string; campaignId: string } | null {
    try {
      const [base64Payload, signature] = token.split('.');
      if (!base64Payload || !signature) {
        return null;
      }

      const payload = Buffer.from(base64Payload, 'base64url').toString('utf8');
      const expectedHmac = crypto
        .createHmac('sha256', this.secret)
        .update(payload)
        .digest('hex');

      if (
        !crypto.timingSafeEqual(
          Buffer.from(signature, 'hex'),
          Buffer.from(expectedHmac, 'hex'),
        )
      ) {
        return null;
      }

      const [email, campaignId] = payload.split('|');
      return { email, campaignId };
    } catch {
      return null;
    }
  }
}

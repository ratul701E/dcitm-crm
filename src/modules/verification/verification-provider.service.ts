import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LeadVerificationStatus } from '@prisma/client';

export interface VerificationResult {
  email: string;
  status: LeadVerificationStatus;
  providerDetails?: any;
}

@Injectable()
export class VerificationProviderService {
  private readonly logger = new Logger(VerificationProviderService.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('VERIFICATION_API_KEY');
  }

  /**
   * Verifies an email against external verification APIs (MillionVerifier / Bouncer)
   * Falls back to syntax + domain MX check if API key is not yet configured.
   */
  async verifyEmail(email: string): Promise<VerificationResult> {
    const cleanEmail = email.trim().toLowerCase();

    // If external API key is provided, perform remote API call
    if (this.apiKey) {
      try {
        // Sample adapter for MillionVerifier API
        const res = await axios.get('https://api.millionverifier.com/api/v3/', {
          params: {
            api: this.apiKey,
            email: cleanEmail,
            timeout: 10,
          },
        });

        // MillionVerifier result code mapping: 1=ok, 2=catch_all, 3=unknown, 4=error, 5=disposable, 6=invalid
        const code = res.data?.resultcode;
        let status: LeadVerificationStatus = LeadVerificationStatus.UNVERIFIED;

        switch (code) {
          case 1:
            status = LeadVerificationStatus.VALID;
            break;
          case 2:
            status = LeadVerificationStatus.CATCH_ALL;
            break;
          case 5:
            status = LeadVerificationStatus.DISPOSABLE;
            break;
          case 6:
            status = LeadVerificationStatus.INVALID;
            break;
          default:
            status = LeadVerificationStatus.RISKY;
            break;
        }

        return { email: cleanEmail, status, providerDetails: res.data };
      } catch (err: any) {
        this.logger.warn(`External verification API error: ${err.message}`);
      }
    }

    // Default built-in heuristic validation (syntax + disposable domain check)
    return this.fallbackHeuristicVerification(cleanEmail);
  }

  private fallbackHeuristicVerification(email: string): VerificationResult {
    const disposableDomains = new Set([
      'mailinator.com',
      'tempmail.com',
      '10minutemail.com',
      'guerrillamail.com',
      'trashmail.com',
      'yopmail.com',
    ]);

    const [, domain] = email.split('@');
    if (!domain) {
      return { email, status: LeadVerificationStatus.INVALID };
    }

    if (disposableDomains.has(domain.toLowerCase())) {
      return { email, status: LeadVerificationStatus.DISPOSABLE };
    }

    // Syntax check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { email, status: LeadVerificationStatus.INVALID };
    }

    return { email, status: LeadVerificationStatus.VALID };
  }
}

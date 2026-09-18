import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SmtpImapConfigDto } from './dto/mailbox.dto';

@Injectable()
export class SmtpValidatorService {
  private readonly logger = new Logger(SmtpValidatorService.name);

  /**
   * Verifies SMTP connection and authentication with STARTTLS enforcement
   */
  async verifySmtp(config: SmtpImapConfigDto): Promise<boolean> {
    try {
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465, // true for 465, false for other ports (587, 25)
        requireTLS: config.smtpPort !== 465, // Enforce STARTTLS for port 587/25
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
        connectionTimeout: 10000,
      });

      await transporter.verify();
      return true;
    } catch (err: any) {
      this.logger.warn(`SMTP validation failed for ${config.smtpUser}: ${err.message}`);
      throw new BadRequestException(`SMTP validation failed: ${err.message}`);
    }
  }
}

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
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
        tls: {
          rejectUnauthorized: false,
        },
      });

      await transporter.verify();
      return true;
    } catch (err: any) {
      this.logger.warn(`SMTP validation failed for ${config.smtpUser}: ${err.message}`);
      throw new BadRequestException(`SMTP validation failed: ${err.message}`);
    }
  }

  /**
   * Verifies IMAP connection and authentication
   */
  async verifyImap(config: SmtpImapConfigDto): Promise<boolean> {
    if (!config.imapHost) {
      return true;
    }

    const isSecure = config.imapPort === 993 || config.imapSecurity === 'ssl';
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort || 993,
      secure: isSecure,
      auth: {
        user: config.imapUser || config.smtpUser,
        pass: config.imapPass || config.smtpPass,
      },
      logger: false,
      connectionTimeout: 12000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
      tls: {
        rejectUnauthorized: false,
      },
    });

    client.on('error', (err: any) => {
      this.logger.warn(`IMAP verification socket error for ${config.imapUser || config.smtpUser}: ${err?.message || err}`);
    });

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch (err: any) {
      this.logger.warn(`IMAP validation failed for ${config.imapUser || config.smtpUser}: ${err.message}`);
      throw new BadRequestException(`IMAP validation failed: ${err.message}`);
    }
  }
}


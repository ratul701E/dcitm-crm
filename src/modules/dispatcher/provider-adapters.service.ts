import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { MailboxType } from '@prisma/client';

export interface OutboundEmailPayload {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  messageId: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  unsubscribeUrl?: string;
}

export interface DispatchResult {
  success: boolean;
  messageId: string;
  error?: string;
}

@Injectable()
export class ProviderAdaptersService {
  private readonly logger = new Logger(ProviderAdaptersService.name);

  /**
   * Dispatches outbound email across Google, Microsoft, or SMTP
   */
  async dispatch(
    type: MailboxType,
    decryptedConfig: any,
    payload: OutboundEmailPayload,
  ): Promise<DispatchResult> {
    switch (type) {
      case MailboxType.SMTP_IMAP:
        return this.sendViaSmtp(decryptedConfig, payload);
      case MailboxType.GOOGLE:
        return this.sendViaGoogle(decryptedConfig, payload);
      case MailboxType.MICROSOFT:
        return this.sendViaMicrosoft(decryptedConfig, payload);
      default:
        throw new Error(`Unsupported mailbox provider: ${type}`);
    }
  }

  // --------------------------------------------------
  // 1. SMTP / Nodemailer Adapter
  // --------------------------------------------------
  private async sendViaSmtp(
    config: any,
    payload: OutboundEmailPayload,
  ): Promise<DispatchResult> {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      requireTLS: config.smtpPort !== 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });

    const headers: Record<string, string> = {
      'Message-ID': `<${payload.messageId}>`,
    };

    if (payload.inReplyTo) {
      headers['In-Reply-To'] = `<${payload.inReplyTo}>`;
    }
    if (payload.references) {
      headers['References'] = `<${payload.references}>`;
    }
    if (payload.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${payload.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    const info = await transporter.sendMail({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: payload.replyTo,
      headers,
    });

    if (info.rejected && info.rejected.length > 0) {
      throw new Error(
        `SMTP recipient rejected: ${info.rejected.join(', ')} - ${info.response || 'Rejected by server'}`,
      );
    }

    return {
      success: true,
      messageId: payload.messageId,
    };
  }

  // --------------------------------------------------
  // 2. Google Workspace / Gmail API Adapter
  // --------------------------------------------------
  private async sendViaGoogle(
    config: any,
    payload: OutboundEmailPayload,
  ): Promise<DispatchResult> {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: config.accessToken || config.authCode,
      refresh_token: config.refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const emailLines = [
      `From: ${payload.from}`,
      `To: ${payload.to}`,
      `Subject: =?utf-8?B?${Buffer.from(payload.subject).toString('base64')}?=`,
      `Message-ID: <${payload.messageId}>`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
    ];

    if (payload.replyTo) {
      emailLines.push(`Reply-To: ${payload.replyTo}`);
    }
    if (payload.inReplyTo) {
      emailLines.push(`In-Reply-To: <${payload.inReplyTo}>`);
    }
    if (payload.references) {
      emailLines.push(`References: <${payload.references}>`);
    }
    if (payload.unsubscribeUrl) {
      emailLines.push(`List-Unsubscribe: <${payload.unsubscribeUrl}>`);
      emailLines.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    }

    emailLines.push('', payload.html);

    const rawMessage = emailLines.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    return { success: true, messageId: payload.messageId };
  }

  // --------------------------------------------------
  // 3. Microsoft 365 / Graph API Adapter
  // --------------------------------------------------
  private async sendViaMicrosoft(
    config: any,
    payload: OutboundEmailPayload,
  ): Promise<DispatchResult> {
    const client = Client.init({
      authProvider: (done) => {
        done(null, config.accessToken || config.authCode);
      },
    });

    const message: any = {
      subject: payload.subject,
      body: {
        contentType: 'HTML',
        content: payload.html,
      },
      toRecipients: [
        {
          emailAddress: {
            address: payload.to,
          },
        },
      ],
      internetMessageHeaders: [
        { name: 'Message-ID', value: `<${payload.messageId}>` },
      ],
    };

    if (payload.replyTo) {
      message.replyTo = [
        {
          emailAddress: {
            address: payload.replyTo,
          },
        },
      ];
    }

    if (payload.inReplyTo) {
      message.internetMessageHeaders.push({
        name: 'In-Reply-To',
        value: `<${payload.inReplyTo}>`,
      });
    }
    if (payload.references) {
      message.internetMessageHeaders.push({
        name: 'References',
        value: `<${payload.references}>`,
      });
    }
    if (payload.unsubscribeUrl) {
      message.internetMessageHeaders.push({
        name: 'List-Unsubscribe',
        value: `<${payload.unsubscribeUrl}>`,
      });
      message.internetMessageHeaders.push({
        name: 'List-Unsubscribe-Post',
        value: 'List-Unsubscribe=One-Click',
      });
    }

    await client.api('/me/sendMail').post({ message, saveToSentItems: 'true' });

    return { success: true, messageId: payload.messageId };
  }
}

import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiHeader,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { SendEmailDto } from './dto/api-key.dto';
import { ApiKeyGuard } from './guards/api-key.guard';

@ApiTags('External Email Dispatch')
@ApiSecurity('api-key')
@ApiHeader({
  name: 'X-API-Key',
  description: 'Programmatic API Key (e.g. crm_live_...)',
  required: true,
})
@UseGuards(ApiKeyGuard)
@Controller('v1/mail')
export class MailSendController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an email programmatically using the authenticated mailbox',
    description:
      'Dispatches an outbound email across the connected mailbox provider (SMTP, Google Gmail, or Microsoft Graph API). Authenticate via `X-API-Key: crm_live_...` or `Authorization: Bearer crm_live_...`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email dispatched successfully',
    schema: {
      example: {
        success: true,
        messageId: '1730825638.9f2b84c0a1@yourcompany.com',
        logId: 'c2451f2c-5690-4e3a-976d-df033b092284',
        to: 'customer@example.com',
        from: '"Support Team" <support@yourcompany.com>',
        sentAt: '2026-11-06T00:15:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed or missing required fields' })
  @ApiResponse({ status: 401, description: 'Invalid, missing, or revoked API Key' })
  @ApiResponse({ status: 429, description: 'Mailbox daily sending quota or API key rate limit reached' })
  @ApiResponse({ status: 502, description: 'Mailbox provider dispatch failure' })
  async sendEmail(@Req() req: any, @Body() dto: SendEmailDto) {
    return this.apiKeysService.sendEmail(req.mailbox, req.apiKey, dto);
  }
}


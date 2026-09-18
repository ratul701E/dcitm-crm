import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiProduces,
} from '@nestjs/swagger';
import * as express from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Tracking Proxy')
@Controller('tracking')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  // 1x1 transparent PNG buffer
  private readonly pixelBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  constructor(private readonly prisma: PrismaService) {}

  @Get('open/:logId')
  @ApiOperation({ summary: '1x1 Transparent tracking pixel for email open tracking' })
  @ApiParam({ name: 'logId', description: 'Outbound email log record UUID' })
  @ApiProduces('image/png')
  @ApiResponse({
    status: 200,
    description: 'Returns 1x1 transparent PNG pixel with cache-busting headers',
  })
  async trackOpen(@Param('logId') logId: string, @Res() res: express.Response) {
    try {
      const log = await this.prisma.emailLog.findUnique({
        where: { id: logId },
      });

      if (log) {
        await this.prisma.emailLog.update({
          where: { id: logId },
          data: {
            openedAt: log.openedAt || new Date(),
            openCount: { increment: 1 },
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Open tracking error for ${logId}: ${err.message}`);
    }

    // Set cache-busting headers so the client/webmail always hits the tracking server
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': this.pixelBuffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });

    res.end(this.pixelBuffer);
  }

  @Get('click/:logId')
  @ApiOperation({ summary: 'Link click tracking proxy endpoint' })
  @ApiParam({ name: 'logId', description: 'Outbound email log record UUID' })
  @ApiQuery({ name: 'url', required: true, description: 'Encoded target destination URL' })
  @ApiResponse({
    status: 302,
    description: 'Records click timestamp and redirects to destination URL',
  })
  @ApiResponse({ status: 400, description: 'Target URL query parameter missing' })
  async trackClick(
    @Param('logId') logId: string,
    @Query('url') targetUrl: string,
    @Res() res: express.Response,
  ) {
    if (!targetUrl) {
      return res.status(400).send('Target URL is missing');
    }

    try {
      const log = await this.prisma.emailLog.findUnique({
        where: { id: logId },
      });

      if (log) {
        await this.prisma.emailLog.update({
          where: { id: logId },
          data: {
            clickedAt: log.clickedAt || new Date(),
            clickCount: { increment: 1 },
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Click tracking error for ${logId}: ${err.message}`);
    }

    // Issue 302 redirect to original destination
    return res.redirect(302, decodeURIComponent(targetUrl));
  }
}

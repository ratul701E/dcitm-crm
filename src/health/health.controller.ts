import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Health & Readiness')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe endpoint for orchestrators' })
  @ApiResponse({
    status: 200,
    description: 'Application process is alive and responsive',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-09-18T10:00:00.000Z' },
        uptime: { type: 'number', example: 124.5 },
      },
    },
  })
  checkLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe endpoint for load balancers' })
  @ApiResponse({
    status: 200,
    description: 'Application is initialized and ready to receive traffic',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ready' },
        timestamp: { type: 'string', example: '2026-09-18T10:00:00.000Z' },
      },
    },
  })
  checkReadiness() {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }
}

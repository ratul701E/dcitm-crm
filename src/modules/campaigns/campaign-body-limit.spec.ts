import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Post, Body, INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { Readable } from 'stream';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';

@Controller('api/campaigns')
class TestCampaignsController {
  @Post()
  createCampaign(@Body() body: any) {
    return {
      success: true,
      data: {
        id: 'test-camp-123',
        title: body.title,
        bodyLength: body.emailBody?.length || 0,
        phasesCount: body.phases?.length || 0,
      },
    };
  }
}

describe('Campaigns Body Parser Limit Integration', () => {
  let app: INestApplication;
  let expressApp: any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TestCampaignsController],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    // Configure 10mb body limit as configured in main.ts
    app.use(json({ limit: '10mb' }));
    app.use(urlencoded({ extended: true, limit: '10mb' }));
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
    expressApp = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  function dispatchRequest(
    payload: any,
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const rawData = Buffer.from(JSON.stringify(payload));
      const req = new Readable({
        read() {
          this.push(rawData);
          this.push(null);
        },
      }) as any;

      req.headers = {
        'content-type': 'application/json',
        'content-length': String(rawData.length),
      };
      req.method = 'POST';
      req.url = '/api/campaigns';

      let resData = '';
      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(k: string, v: string) {
          this.headers[k.toLowerCase()] = v;
        },
        getHeader(k: string) {
          return this.headers[k.toLowerCase()];
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        end(chunk?: any) {
          if (chunk) resData += chunk;
          try {
            resolve({ status: this.statusCode, body: JSON.parse(resData) });
          } catch {
            resolve({ status: this.statusCode, body: resData });
          }
        },
        write(chunk: any) {
          if (chunk) resData += chunk;
        },
        json(obj: any) {
          this.setHeader('content-type', 'application/json');
          this.end(JSON.stringify(obj));
        },
      };

      expressApp(req, res);
    });
  }

  it('1. should accept a normal campaign creation request (< 100kb)', async () => {
    const payload = {
      title: 'Standard Cold Outreach',
      subject: 'Quick question about {{company}}',
      emailBody:
        '<p>Hi {{firstName}}, wondering if you need help scaling outreach?</p>',
      phases: [
        {
          title: 'Phase 1',
          subject: 'Introduction',
          bodyContent: '<p>Initial pitch</p>',
        },
      ],
    };

    const res = await dispatchRequest(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Standard Cold Outreach');
  });

  it('2. should accept a request larger than the previous limit (100kb) but within the new limit (10mb)', async () => {
    // 500kb HTML content (simulating large rich-text templates with inline styles/images)
    const largeHtmlTemplate = '<p>' + 'A'.repeat(500 * 1024) + '</p>';
    const payload = {
      title: 'High Volume Rich Template Campaign',
      subject: 'Quarterly Newsletter with Embedded Elements',
      emailBody: largeHtmlTemplate,
      phases: [
        {
          title: 'Phase 1',
          subject: 'Phase 1 Subject',
          bodyContent: largeHtmlTemplate,
        },
      ],
    };

    const res = await dispatchRequest(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bodyLength).toBeGreaterThan(100 * 1024);
  });

  it('3. should reject a request exceeding the 10mb limit and return HTTP 413 via GlobalExceptionFilter', async () => {
    // Construct payload > 10mb (approx 10.5 MB)
    const hugeBody = 'X'.repeat(10.5 * 1024 * 1024);
    const payload = {
      title: 'Massive Payload Campaign',
      emailBody: hugeBody,
    };

    const res = await dispatchRequest(payload);

    expect(res.status).toBe(413);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        statusCode: 413,
        path: '/api/campaigns',
        message: 'Request entity too large',
      }),
    );
    // Ensure no internal stack trace leaked to client
    expect(res.body.stack).toBeUndefined();
  });
});

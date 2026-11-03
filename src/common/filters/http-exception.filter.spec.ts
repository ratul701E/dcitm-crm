import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      method: 'POST',
      url: '/api/campaigns',
    };
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;
  });

  describe('PayloadTooLargeError handling', () => {
    it('should catch raw-body / body-parser PayloadTooLargeError and return HTTP 413', () => {
      const payloadError = new Error('request entity too large');
      (payloadError as any).name = 'PayloadTooLargeError';
      (payloadError as any).type = 'entity.too.large';
      (payloadError as any).status = 413;
      (payloadError as any).statusCode = 413;
      (payloadError as any).limit = 10485760;
      (payloadError as any).received = 15000000;

      filter.catch(payloadError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          path: '/api/campaigns',
          message: 'Request entity too large',
        }),
      );
      // Ensure no stack trace is leaked in response
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.stack).toBeUndefined();
      expect(jsonArg.limit).toBeUndefined();
    });

    it('should catch error identified solely by type "entity.too.large" and return HTTP 413', () => {
      const error = new Error('custom entity too large');
      (error as any).type = 'entity.too.large';

      filter.catch(error, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          path: '/api/campaigns',
          message: 'custom entity too large',
        }),
      );
    });

    it('should catch NestJS PayloadTooLargeException and return HTTP 413', () => {
      const exception = new PayloadTooLargeException(
        'Custom payload limit exceeded',
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          path: '/api/campaigns',
          message: 'Custom payload limit exceeded',
        }),
      );
    });
  });

  describe('Standard HttpException handling', () => {
    it('should handle NotFoundException (404)', () => {
      const exception = new NotFoundException('Campaign not found');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.NOT_FOUND,
          path: '/api/campaigns',
          message: 'Campaign not found',
        }),
      );
    });

    it('should handle BadRequestException with validation errors (400)', () => {
      const exception = new BadRequestException({
        message: 'Validation failed',
        errors: [{ field: 'title', message: 'Title is required' }],
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Validation failed',
          errors: [{ field: 'title', message: 'Title is required' }],
        }),
      );
    });

    it('should handle string response HttpException', () => {
      const exception = new HttpException(
        'Forbidden access',
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Forbidden access',
        }),
      );
    });
  });

  describe('Unhandled Error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return 500 with generic message in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Sensitive database credentials leak');

      filter.catch(error, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        }),
      );
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.message).not.toContain('credentials');
      expect(jsonArg.stack).toBeUndefined();
    });

    it('should return error message in development/test', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Developer debug error');

      filter.catch(error, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Developer debug error',
        }),
      );
    });

    it('should respect status code on custom non-HttpException errors', () => {
      const customError = new Error('Custom service unavailable');
      (customError as any).status = HttpStatus.SERVICE_UNAVAILABLE;

      filter.catch(customError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Custom service unavailable',
        }),
      );
    });
  });
});

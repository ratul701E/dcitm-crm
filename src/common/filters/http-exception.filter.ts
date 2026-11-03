import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface CustomHttpError {
  name?: string;
  type?: string;
  status?: number;
  statusCode?: number;
  message?: string;
  stack?: string;
  errors?: unknown;
  error?: unknown;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errObj =
      typeof exception === 'object' && exception !== null
        ? (exception as CustomHttpError)
        : null;

    const isPayloadTooLarge =
      errObj?.type === 'entity.too.large' ||
      errObj?.name === 'PayloadTooLargeError' ||
      errObj?.status === (HttpStatus.PAYLOAD_TOO_LARGE as number) ||
      errObj?.statusCode === (HttpStatus.PAYLOAD_TOO_LARGE as number) ||
      (exception instanceof HttpException &&
        exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (isPayloadTooLarge) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
    } else if (
      typeof errObj?.status === 'number' &&
      errObj.status >= 400 &&
      errObj.status < 600
    ) {
      status = errObj.status;
    } else if (
      typeof errObj?.statusCode === 'number' &&
      errObj.statusCode >= 400 &&
      errObj.statusCode < 600
    ) {
      status = errObj.statusCode;
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal server error';
    let errors: unknown = null;

    if (isPayloadTooLarge) {
      const respObj =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as Record<string, unknown>)
          : null;

      const respMessage =
        typeof respObj?.message === 'string'
          ? respObj.message
          : typeof exceptionResponse === 'string'
            ? exceptionResponse
            : null;

      message =
        respMessage ||
        (exception instanceof Error && exception.message
          ? exception.message === 'request entity too large'
            ? 'Request entity too large'
            : exception.message
          : 'Request entity too large');
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      const respObj = exceptionResponse as Record<string, unknown>;
      message =
        typeof respObj.message === 'string' ? respObj.message : message;
      errors = respObj.errors ?? respObj.error ?? null;
    } else if (exception instanceof Error) {
      message =
        status === HttpStatus.INTERNAL_SERVER_ERROR &&
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : exception.message;
    }

    // Sanitize any accidental sensitive leaks in logs
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${request.method}] ${request.url} - Status: ${status} - Error: ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      this.logger.warn(
        `[${request.method}] ${request.url} - Status: ${status} - PayloadTooLarge: ${JSON.stringify(message)}`,
      );
    } else {
      this.logger.warn(
        `[${request.method}] ${request.url} - Status: ${status} - Message: ${JSON.stringify(message)}`,
      );
    }

    const errorPayload: Record<string, unknown> = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (errors !== null && errors !== undefined) {
      errorPayload.errors = errors;
    }

    response.status(status).json(errorPayload);
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES, type Problem } from '@crm/contracts';
import { AppError } from '../errors/app-error';
import { RequestContextStore } from '../context/request-context';

/**
 * Single exit point for every error. Emits RFC 9457 problem+json:
 *
 *   { type, title, status, detail, code, requestId, errors? }
 *
 * Nothing else in the codebase formats an error response. That is what makes
 * the shape dependable enough for the frontend to build on.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = RequestContextStore.peek()?.requestId;

    const problem = this.toProblem(exception, request.url, requestId);

    // 5xx means we broke something — log the stack. 4xx is the caller's
    // problem and logging stacks for those just buries the real incidents.
    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, path: request.url, requestId },
        `Unhandled error: ${problem.detail}`,
      );
    } else {
      this.logger.debug({ path: request.url, code: problem.code, requestId }, problem.title);
    }

    response.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, path: string, requestId?: string): Problem {
    if (exception instanceof AppError) {
      const body = exception.getResponse() as { code: string; message: string };
      return {
        type: `https://errors.crm.platform/${body.code.toLowerCase()}`,
        title: this.titleFor(exception.getStatus()),
        status: exception.getStatus(),
        detail: body.message,
        instance: path,
        code: body.code,
        requestId,
        errors: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const detail =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);
      return {
        type: 'about:blank',
        title: this.titleFor(status),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance: path,
        code: this.codeForStatus(status),
        requestId,
      };
    }

    // Unknown: never leak internals to the caller. The stack is in the log,
    // correlated by requestId.
    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
      instance: path,
      code: ERROR_CODES.INTERNAL,
      requestId,
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODES.VALIDATION_FAILED;
      default:
        return status >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION_FAILED;
    }
  }

  private titleFor(status: number): string {
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      503: 'Service Unavailable',
    };
    return titles[status] ?? 'Error';
  }
}

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
import { maskSecretUrl } from '../logging/mask-secret-url';
import { reportServerError } from '../../modules/platform-infrastructure';

/**
 * A surface whose clients expect their own error body (Reference's `/api/v1` answers `{ error: { code, message } }`) registers a renderer for
 * its path prefix. The problem is still built, logged and reported here; the renderer only decides how it is written. Returns true when
 * it wrote the response.
 */
export type ProblemRenderer = (problem: Problem, request: Request, response: Response) => boolean;
const problemRenderers: Array<{ prefix: string; render: ProblemRenderer }> = [];

export function registerProblemRenderer(prefix: string, render: ProblemRenderer): void {
  if (problemRenderers.some((r) => r.prefix === prefix)) return;
  problemRenderers.push({ prefix, render });
  // The longest prefix answers first, so a client with its own envelope under another's path (`/api/v1/sheets-addon` inside `/api/v1`)
  // is not decided by which module happened to start first.
  problemRenderers.sort((a, b) => b.prefix.length - a.prefix.length);
}

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
    // An AppError flagged `expected` is a 5xx that is a handled state (an integration that is switched off): quiet, like a 4xx.
    const expected = exception instanceof AppError && exception.expected;
    if (problem.status >= 500 && !expected) {
      this.logger.error(
        { err: exception, path: maskSecretUrl(request.url), requestId },
        `Unhandled error: ${problem.detail}`,
      );
      reportServerError(exception, { requestId, path: request.url });
    } else {
      this.logger.debug(
        { path: maskSecretUrl(request.url), code: problem.code, requestId },
        problem.title,
      );
    }

    const path = request.path ?? request.url;
    for (const { prefix, render } of problemRenderers) {
      if (path.startsWith(prefix) && render(problem, request, response)) return;
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

    // Errors raised by the body parser before Nest routes the request (http-errors shape: a 4xx
    // `status`, `expose: true` and a `type`): an oversized body is a 413 and unreadable JSON a 400,
    // not an internal error.
    const parsed = this.bodyParserError(exception);
    if (parsed) {
      return {
        type: 'about:blank',
        title: this.titleFor(parsed.status),
        status: parsed.status,
        detail: parsed.detail,
        instance: path,
        code: this.codeForStatus(parsed.status),
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

  private bodyParserError(exception: unknown): { status: number; detail: string } | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const e = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
    const status = typeof e.status === 'number' ? e.status : e.statusCode;
    if (e.type === 'entity.too.large' && status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return { status, detail: 'The request body is too large.' };
    }
    if (
      (e.type === 'entity.parse.failed' || e.type === 'encoding.unsupported') &&
      status === HttpStatus.BAD_REQUEST
    ) {
      return { status, detail: 'The request body could not be read.' };
    }
    return null;
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
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ERROR_CODES.PAYLOAD_TOO_LARGE;
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
      413: 'Payload Too Large',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      503: 'Service Unavailable',
    };
    return titles[status] ?? 'Error';
  }
}

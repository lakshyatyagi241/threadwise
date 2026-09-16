import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@crm/contracts';

/**
 * Every deliberate failure in this codebase is an AppError.
 *
 * It carries a stable machine code alongside the HTTP status, so the frontend
 * can branch on `WALLET_INSUFFICIENT_FUNDS` instead of pattern-matching a
 * message that will be reworded next sprint.
 */
export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Array<{ path: string; message: string }>,
  ) {
    super({ code, message }, status);
    this.code = code;
    this.details = details;
  }

  static notFound(resource: string, id?: string): AppError {
    return new AppError(
      ERROR_CODES.NOT_FOUND,
      id ? `${resource} ${id} not found` : `${resource} not found`,
      HttpStatus.NOT_FOUND,
    );
  }

  static forbidden(permission: string): AppError {
    return new AppError(
      ERROR_CODES.FORBIDDEN,
      `Missing permission: ${permission}`,
      HttpStatus.FORBIDDEN,
    );
  }

  static unauthenticated(detail = 'Authentication required'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, detail, HttpStatus.UNAUTHORIZED);
  }

  /**
   * Optimistic-lock failure: the row moved between the client's read and its
   * write. The client must re-read and re-apply — never retry blindly.
   */
  static rowVersionConflict(resource: string): AppError {
    return new AppError(
      ERROR_CODES.ROW_VERSION_CONFLICT,
      `${resource} was modified by someone else. Reload and try again.`,
      HttpStatus.CONFLICT,
    );
  }

  static validation(message: string, details?: Array<{ path: string; message: string }>): AppError {
    return new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }
}

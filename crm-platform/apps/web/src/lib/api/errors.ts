import { problemSchema } from '@crm/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fieldErrors: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isRowVersionConflict(): boolean {
    return this.status === 409 && this.code === 'ROW_VERSION_CONFLICT';
  }
}

/** Branch on `code`, never on the title/detail text. Falls back to a generic error for non-problem bodies. */
export function toApiError(
  status: number,
  body: unknown,
  headerRequestId?: string | null,
): ApiError {
  const parsed = problemSchema.safeParse(body);
  if (parsed.success) {
    const p = parsed.data;
    return new ApiError(
      status,
      p.code,
      p.detail ?? p.title,
      p.requestId ?? headerRequestId ?? undefined,
      p.errors ?? [],
    );
  }
  return new ApiError(
    status,
    status >= 500 ? 'INTERNAL' : 'UNKNOWN',
    `Request failed with status ${status}`,
    headerRequestId ?? undefined,
  );
}

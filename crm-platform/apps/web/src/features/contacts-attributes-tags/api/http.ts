import { pageResponseSchema } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/**
 * Reads every page of a cursor list. For short, workspace-wide lists the screens need whole (tags, attributes,
 * groups, status options) so a picker never shows half a list. Capped so a runaway server cannot loop forever.
 */
export async function fetchAllPages<T>(
  path: string,
  item: z.ZodType<T>,
  query: Record<string, string | number | boolean | undefined> = {},
  opts: { signal?: AbortSignal; maxPages?: number } = {},
): Promise<T[]> {
  const schema = pageResponseSchema(item);
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < (opts.maxPages ?? 20); i++) {
    const page = await apiFetch(path, {
      query: { limit: 200, ...query, cursor },
      schema,
      signal: opts.signal,
    });
    out.push(...page.data);
    if (!page.page.hasMore || !page.page.nextCursor) break;
    cursor = page.page.nextCursor;
  }
  return out;
}

/** The API answered "no such route": the endpoint has not been built yet, which is not the same as a failure. */
export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.isRowVersionConflict;
}

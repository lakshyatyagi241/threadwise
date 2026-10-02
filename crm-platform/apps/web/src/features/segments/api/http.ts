import { pageResponseSchema } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch, type ApiRequest } from '@/lib/api/client';

/**
 * Every segments call goes through here. Normally that is the real API. While the segments endpoints are not deployed, a
 * developer can switch the in-memory stand-in on (`NEXT_PUBLIC_SEGMENTS_MOCK=1`, or `localStorage['segments:mock'] =
 * '1'` then reload) to work on the screens; it answers with the same shapes, parsed by the same schemas, and evaluates
 * the rules over the workspace's real contacts. It is off unless asked for.
 */
export function mockEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_SEGMENTS_MOCK === '1') return true;
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('segments:mock') === '1';
  } catch {
    return false;
  }
}

export async function call<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  if (mockEnabled()) {
    const { mockCall } = await import('./mock-server');
    return mockCall(path, req);
  }
  return apiFetch(path, req);
}

/** Every page of a short cursor list (segments, people), capped so a runaway server cannot loop forever. */
export async function fetchAll<T>(
  path: string,
  item: z.ZodType<T>,
  query: Record<string, string | number | boolean | undefined> = {},
  opts: { signal?: AbortSignal; maxPages?: number } = {},
): Promise<T[]> {
  const schema = pageResponseSchema(item);
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < (opts.maxPages ?? 20); i++) {
    const page = await call(path, {
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

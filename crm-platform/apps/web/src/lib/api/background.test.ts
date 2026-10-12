import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_META, isBackgroundFailure } from './background';
import { ApiError } from './errors';

async function run(error: unknown, meta?: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client
    .fetchQuery({
      queryKey: ['q'],
      queryFn: () => Promise.reject(error),
      meta,
    })
    .catch(() => undefined);
  return client.getQueryCache().find({ queryKey: ['q'] })!;
}

describe('isBackgroundFailure', () => {
  it('is true for a tagged query that failed on a network error', async () => {
    expect(isBackgroundFailure(await run(new TypeError('fetch failed'), BACKGROUND_META))).toBe(
      true,
    );
  });

  it('is false for a query that is not tagged', async () => {
    expect(isBackgroundFailure(await run(new TypeError('fetch failed')))).toBe(false);
  });

  it('is false for a tagged query that failed with a 4xx', async () => {
    const e = new ApiError(403, 'FORBIDDEN', 'Forbidden');
    expect(isBackgroundFailure(await run(e, BACKGROUND_META))).toBe(false);
  });

  it('is true for a tagged query that failed with a 5xx', async () => {
    const e = new ApiError(500, 'INTERNAL', 'Boom');
    expect(isBackgroundFailure(await run(e, BACKGROUND_META))).toBe(true);
  });
});

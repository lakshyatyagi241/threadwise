import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { databaseFor } from '@crm/db';

/**
 * The drizzle database of a pooled connection is built once (QA soak: building it per transaction was 53% of the API's CPU). A fake
 * connection is enough: drizzle builds its session lazily and sends nothing until a query runs.
 */
const fakeClient = () =>
  ({ query: () => Promise.reject(new Error('not used')) }) as unknown as PoolClient;

describe('databaseFor', () => {
  it('returns the same database for the same connection, however often it is asked', () => {
    const a = fakeClient();
    const first = databaseFor(a);
    for (let i = 0; i < 50; i++) expect(databaseFor(a)).toBe(first);
  });

  it('gives each connection its own database, so two connections never share a session', () => {
    const a = fakeClient();
    const b = fakeClient();
    expect(databaseFor(a)).not.toBe(databaseFor(b));
  });

  it('is much cheaper than building one: 2,000 lookups cost less than a handful of builds', () => {
    const a = fakeClient();
    databaseFor(a);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) databaseFor(a);
    const cached = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) databaseFor(fakeClient());
    const built = performance.now() - t1;
    // 100x more lookups than builds, still faster in total than the builds
    expect(cached).toBeLessThan(built);
  });
});

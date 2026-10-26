import { describe, expect, it } from 'vitest';
import { Registry } from './prometheus-text';
import { poolAcquireRecorder } from './db-saturation';

// Sheet 3 D-07: crm_db_pool_acquire_seconds, fed by the checkout timer in packages/db (onAcquire, in milliseconds).
describe('poolAcquireRecorder', () => {
  it('records milliseconds as seconds, per pool, with buckets that resolve 5 ms', () => {
    const registry = new Registry({ service: 'api' });
    const record = poolAcquireRecorder(registry);
    record('primary', 2); // 2 ms
    record('primary', 8);
    record('webhook', 400);
    const text = registry.render();
    expect(text).toMatch(
      /crm_db_pool_acquire_seconds_bucket\{[^}]*pool="primary"[^}]*le="0.0025"\} 1/,
    );
    expect(text).toMatch(
      /crm_db_pool_acquire_seconds_bucket\{[^}]*pool="primary"[^}]*le="0.005"\} 1/,
    );
    expect(text).toMatch(
      /crm_db_pool_acquire_seconds_bucket\{[^}]*pool="primary"[^}]*le="0.01"\} 2/,
    );
    expect(text).toMatch(/crm_db_pool_acquire_seconds_count\{[^}]*pool="webhook"[^}]*\} 1/);
  });

  it('is one family per registry however often it is asked for (a registry does not de-duplicate)', () => {
    const registry = new Registry({ service: 'api' });
    poolAcquireRecorder(registry)('primary', 1);
    poolAcquireRecorder(registry)('primary', 1);
    const types = registry.render().match(/# TYPE crm_db_pool_acquire_seconds histogram/g) ?? [];
    expect(types.length).toBe(1);
    expect(registry.render()).toMatch(/crm_db_pool_acquire_seconds_count\{[^}]*\} 2/);
  });
});

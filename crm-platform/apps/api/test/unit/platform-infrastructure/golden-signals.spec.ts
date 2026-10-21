import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Registry, createDbSaturationMetrics } from '@crm/observability';

const ROOT = resolve(__dirname, '../../../../..');
const matrix = JSON.parse(
  readFileSync(join(ROOT, 'docs/performance/metrics/golden-signals.json'), 'utf8'),
) as {
  newMetrics: string[];
  services: Record<string, Record<string, { status: string; metrics?: string[]; reason?: string }>>;
};

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push(p);
  }
  return out;
}
const code = [join(ROOT, 'packages/observability/src'), join(ROOT, 'apps/api/src')]
  .flatMap((d) => sources(d))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

describe('golden signals matrix ratchet', () => {
  it('every metric marked present exists in the code, and missing/n-a entries say why', () => {
    for (const [svc, signals] of Object.entries(matrix.services)) {
      for (const sig of ['latency', 'traffic', 'errors', 'saturation']) {
        const e = signals[sig];
        expect(e, `${svc}.${sig} is in the matrix`).toBeDefined();
        if (e!.status === 'present') {
          expect(e!.metrics?.length, `${svc}.${sig} lists metrics`).toBeGreaterThan(0);
          for (const m of e!.metrics!) expect(code, `${svc}.${sig}: ${m}`).toContain(`'${m}'`);
        } else {
          expect(e!.reason, `${svc}.${sig} has a reason`).toBeTruthy();
        }
      }
    }
  });
});

describe('db saturation and outbox metrics', () => {
  it('reads pool and outbox values back from the exposition text', () => {
    const reg = new Registry({ service: 'api', instance: 't' });
    const m = createDbSaturationMetrics(reg);
    m.recordPool('primary', { totalCount: 7, idleCount: 2, waitingCount: 3, options: { max: 20 } });
    m.recordOutbox({ ready: 41, lagSeconds: 9, dead: 2 });
    const text = reg.render();
    expect(text).toMatch(/crm_db_pool_connections\{[^}]*pool="primary"[^}]*state="total"[^}]*\} 7/);
    expect(text).toMatch(/crm_db_pool_connections\{[^}]*state="idle"[^}]*\} 2/);
    expect(text).toMatch(/crm_db_pool_waiting\{[^}]*pool="primary"[^}]*\} 3/);
    expect(text).toMatch(/crm_db_pool_max\{[^}]*\} 20/);
    expect(text).toMatch(/crm_outbox_ready\{[^}]*\} 41/);
    expect(text).toMatch(/crm_outbox_oldest_due_seconds\{[^}]*\} 9/);
    expect(text).toMatch(/crm_outbox_dead\{[^}]*\} 2/);
    for (const n of matrix.newMetrics) expect(text).toContain(`# TYPE ${n} gauge`);
  });
});

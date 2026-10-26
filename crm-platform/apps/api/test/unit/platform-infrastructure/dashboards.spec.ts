import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Grafana dashboards (EL-B04) are generated JSON. These checks keep them honest without a Grafana: every metric a panel asks for
// is one the code exports, every variable is declared, the PromQL is placed legally. Whether Grafana and Prometheus accept the
// queries and return data is checked against the real pair by tools/event-loop-audit/scrape-demo.mjs --grafana.
const repo = resolve(__dirname, '../../../../..');
const dashDir = join(repo, 'deploy/observability/grafana/dashboards');
// The monitor core is in packages/observability (shared with the web server); the job, HTTP-side and probe series are in the API.
const obsDirs = [
  join(repo, 'packages/observability/src'),
  join(repo, 'apps/api/src/modules/platform-infrastructure/observability/event-loop'),
  join(repo, 'apps/api/src/realtime'), // crm_realtime_* (realtime-metrics.ts)
];

interface Target {
  expr?: string;
  datasource?: { uid?: string };
}
interface Panel {
  id: number;
  type: string;
  title: string;
  targets?: Target[];
  datasource?: { uid?: string };
  gridPos: { x: number; w: number };
}
interface Dashboard {
  uid: string;
  title: string;
  panels: Panel[];
  templating: { list: { name: string; type: string }[] };
  annotations: { list: { name: string; expr?: string }[] };
}

const files = readdirSync(dashDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const dashboards = files.map((f) => ({
  file: f,
  d: JSON.parse(readFileSync(join(dashDir, f), 'utf8')) as Dashboard,
}));

/** Every `crm_*` metric the code can emit: registered names in the monitor, plus the probe's. */
function exportedMetrics(): Set<string> {
  const names = new Set<string>();
  for (const dir of obsDirs) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/['"`](crm_[a-z0-9_]+)['"`]/g)) {
        names.add(m[1]!);
      }
    }
  }
  return names;
}
/** A histogram `crm_x` exposes crm_x_bucket, crm_x_sum and crm_x_count. */
const baseName = (n: string) => n.replace(/_(bucket|sum|count)$/, '');

const exprsOf = (d: Dashboard) =>
  [
    ...d.panels.flatMap((p) => (p.targets ?? []).map((t) => t.expr ?? '')),
    ...d.annotations.list.map((a) => a.expr ?? ''),
    ...d.templating.list.map((v) => (v as { definition?: string }).definition ?? ''),
  ].filter(Boolean);

describe('Grafana dashboards (EL-B04)', () => {
  it('ships the five dashboards', () => {
    expect(dashboards.map((x) => x.d.uid)).toEqual([
      'crm-api',
      'crm-realtime',
      'crm-release-comparison',
      'crm-slow-queries',
      'crm-web',
      'crm-workers',
    ]);
  });

  it('uses only metrics the code exports', () => {
    const exported = exportedMetrics();
    expect(exported.size).toBeGreaterThan(20);
    // crm-slow-queries is hand-written; its crm_slow_query_* / crm_chat_bridge_* series come from the chat-bridge/watcher services, not these dirs.
    for (const { file, d } of dashboards.filter((x) => x.d.uid !== 'crm-slow-queries')) {
      for (const expr of exprsOf(d)) {
        for (const m of expr.matchAll(/\bcrm_[a-z0-9_]+/g)) {
          const name = m[0];
          expect(
            exported.has(name) || exported.has(baseName(name)),
            `${file}: ${name} is not exported by the runtime monitor, the job metrics or the probe`,
          ).toBe(true);
        }
      }
    }
  });

  it('points every panel and query at the provisioned data source', () => {
    for (const { file, d } of dashboards) {
      for (const p of d.panels.filter((x) => x.targets?.length)) {
        expect(p.datasource?.uid, `${file}: ${p.title}`).toBe('crm-prometheus');
        for (const t of p.targets!)
          expect(t.datasource?.uid, `${file}: ${p.title}`).toBe('crm-prometheus');
      }
    }
    const ds = readFileSync(
      join(repo, 'deploy/observability/grafana/provisioning/datasources/prometheus.yml'),
      'utf8',
    );
    expect(ds).toMatch(/uid:\s*crm-prometheus/);
  });

  it('has unique panel ids and no panel running off the 24-column grid', () => {
    for (const { file, d } of dashboards) {
      const ids = d.panels.map((p) => p.id);
      expect(new Set(ids).size, `${file}: duplicate panel ids`).toBe(ids.length);
      for (const p of d.panels) {
        expect(p.gridPos.x + p.gridPos.w, `${file}: ${p.title}`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('declares every template variable it uses', () => {
    const builtin = new Set(['__rate_interval', '__interval', '__range', '__from', '__to']);
    for (const { file, d } of dashboards) {
      const declared = new Set(d.templating.list.map((v) => v.name));
      const text = JSON.stringify(
        d.panels
          .map((p) => [p.title, ...(p.targets ?? []).map((t) => t.expr)])
          .concat(d.annotations.list.map((a) => a.expr)),
      );
      for (const m of text.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
        const v = m[1]!;
        expect(declared.has(v) || builtin.has(v), `${file}: $${v} is not a declared variable`).toBe(
          true,
        );
      }
    }
  });

  it('writes PromQL that Prometheus accepts structurally: balanced, offset only after a selector', () => {
    for (const { file, d } of dashboards) {
      for (const expr of exprsOf(d)) {
        let depth = 0;
        for (const c of expr) {
          if (c === '(' || c === '{' || c === '[') depth += 1;
          if (c === ')' || c === '}' || c === ']') depth -= 1;
          expect(depth, `${file}: ${expr}`).toBeGreaterThanOrEqual(0);
        }
        expect(depth, `${file}: unbalanced ${expr}`).toBe(0);
        // `offset` is legal right after a selector or a range (`m{..}` / `m{..}[5m]`), never after a closing paren.
        expect(expr, `${file}: offset after a call, which PromQL rejects`).not.toMatch(
          /\)\s*offset\b/,
        );
      }
    }
  });

  it('says plainly what the realtime and release dashboards do not measure', () => {
    const rt = dashboards.find((x) => x.d.uid === 'crm-realtime')!.d;
    const note = rt.panels.find((p) => p.type === 'text')!;
    expect(JSON.stringify(note)).toMatch(/Still not measured/);
    const rel = dashboards.find((x) => x.d.uid === 'crm-release-comparison')!.d;
    expect(JSON.stringify(rel.panels.find((p) => p.type === 'text'))).toMatch(/By release/);
  });
});

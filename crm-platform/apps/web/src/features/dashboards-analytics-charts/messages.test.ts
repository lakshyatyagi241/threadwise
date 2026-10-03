import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every literal message key a component asks for exists in messages/en/dashboards-analytics-charts.json (next-intl would
 * otherwise print the key path on screen). Keys built at run time are covered by the dynamic checks below.
 */
const WEB = resolve(__dirname, '../../..');
type Tree = { [k: string]: string | Tree };
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages/en/dashboards-analytics-charts.json'), 'utf8'),
) as Tree;

function has(path: string): boolean {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined;
}

const dir = join(__dirname, 'components');
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

describe('dashboard messages', () => {
  it.each(files)('%s asks only for keys that exist', (file) => {
    // each component function declares its own translators, so check them one function at a time
    const blocks = readFileSync(join(dir, file), 'utf8').split(/\n(?=export function |function )/);
    const missing: string[] = [];
    for (const src of blocks) {
      const namespaces = [...src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)].map(
        (m) => [m[1]!, m[2]!] as const,
      );
      for (const [v, ns] of namespaces) {
        for (const m of src.matchAll(new RegExp(`\\b${v}\\('([^']+)'`, 'g'))) {
          if (!has(`${ns}.${m[1]}`)) missing.push(`${ns}.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the run-time keys resolve: ranges, stages, message types, greetings', () => {
    const base = 'dashboards-analytics-charts';
    for (const r of ['24h', '7d', '30d', '90d', 'qtd', 'custom'])
      expect(has(`${base}.range.short.${r}`)).toBe(true);
    for (const r of ['24h', '7d', '30d', 'qtd']) {
      expect(has(`${base}.range.long.${r}`)).toBe(true);
      expect(has(`${base}.dashboard.throughput.subtitle.${r}`)).toBe(true);
    }
    for (const s of ['sent', 'delivered', 'replied', 'engaged'])
      expect(has(`${base}.funnel.stage.${s}`)).toBe(true);
    for (const k of ['text', 'template', 'media', 'interactive', 'location'])
      expect(has(`${base}.analytics.types.${k}`)).toBe(true);
    for (const g of ['morning', 'afternoon', 'evening'])
      expect(has(`${base}.dashboard.greeting.${g}`)).toBe(true);
  });

  it('dashboard-cards.tsx asks only for keys that exist (its namespaces are built from BASE)', () => {
    const src = readFileSync(join(dir, 'dashboard-cards.tsx'), 'utf8');
    const base = 'dashboards-analytics-charts.dashboard';
    const missing: string[] = [];
    for (const block of src.split(/\n(?=export function |function )/)) {
      const vars = [...block.matchAll(/const (\w+) = useTranslations\(`\$\{BASE\}\.(\w+)`\)/g)].map(
        (m) => [m[1]!, m[2]!] as const,
      );
      for (const [v, ns] of vars) {
        for (const m of block.matchAll(new RegExp(`\\b${v}\\('([^']+)'`, 'g'))) {
          if (!has(`${base}.${ns}.${m[1]}`)) missing.push(`${ns}.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
    for (const st of ['processing', 'scheduled', 'paused', 'failed', 'completed'])
      expect(has(`${base}.campaigns.status.${st}`)).toBe(true);
    for (const st of ['approved', 'pending', 'rejected'])
      expect(has(`${base}.templates.status.${st}`)).toBe(true);
  });
});

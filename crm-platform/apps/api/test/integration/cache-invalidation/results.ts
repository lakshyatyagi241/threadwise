import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const FILE = resolve(__dirname, '../../../../../docs/performance/cache/invalidation-results.json');

/**
 * Writes one measured number under `measured` in docs/performance/cache/invalidation-results.json when CACHE_INVALIDATION_WRITE=1
 * (how the report's numbers were produced). A plain test run only asserts.
 */
export function record(section: string, values: Record<string, unknown>): void {
  if (process.env.CACHE_INVALIDATION_WRITE !== '1') return;
  let all: { measured?: Record<string, unknown> } = {};
  try {
    all = JSON.parse(readFileSync(FILE, 'utf8')) as typeof all;
  } catch {
    /* first write */
  }
  all.measured = { ...all.measured, [section]: values };
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n');
}

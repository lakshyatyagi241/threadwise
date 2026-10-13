import { resolve, type Resolved } from '../registry';
import { readManifest } from './manifest';
import type { Source } from './source';

export interface CoverageRow {
  collection: string;
  count: number;
  status: 'MIGRATED' | 'MIGRATE_LATER' | 'EXCLUDED' | 'GAP' | 'OPEN' | 'UNKNOWN';
  reg: Resolved;
}

const STATUS = {
  MIGRATE: 'MIGRATED',
  MIGRATE_LATER: 'MIGRATE_LATER',
  EXCLUDE: 'EXCLUDED',
  GAP: 'GAP',
  OPEN: 'OPEN',
  UNKNOWN: 'UNKNOWN',
} as const;

/** Source collections vs the registry. Counts come from the manifest when there is one, else by counting. */
export async function coverage(
  source: Source,
  dumpsDir: string,
  client: string,
): Promise<CoverageRow[]> {
  const manifest = readManifest(dumpsDir, client);
  const rows: CoverageRow[] = [];
  for (const collection of source.collections(client)) {
    let count = manifest?.collections.find((c) => c.collection === collection)?.docs;
    if (count === undefined) {
      count = 0;
      for await (const _doc of source.read(client, collection)) count++;
    }
    const reg = resolve(collection);
    rows.push({ collection, count, status: STATUS[reg.disposition], reg });
  }
  return rows;
}

export function formatCoverage(client: string, rows: CoverageRow[]): string {
  const lines = [`coverage for ${client}`, ''];
  for (const r of rows) {
    lines.push(
      `${r.status.padEnd(13)} ${r.collection.padEnd(52)} ${String(r.count).padStart(9)}  ${r.reg.reason}`,
    );
  }
  const tally: Record<string, number> = {};
  for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
  lines.push(
    '',
    Object.entries(tally)
      .map(([k, v]) => `${k}=${v}`)
      .join('  '),
  );
  if (tally.UNKNOWN)
    lines.push('ALARM: collections not in the registry. Decide each one before running.');
  return lines.join('\n');
}

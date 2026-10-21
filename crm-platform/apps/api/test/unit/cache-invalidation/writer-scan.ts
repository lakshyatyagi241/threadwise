import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Finds the files that WRITE a table: raw SQL (`INSERT INTO t`, `UPDATE t`, `DELETE FROM t`) and drizzle (`.insert(tCamel)` ...).
 * With `column`, a statement only counts when the next 600 characters assign that column (`column =` or in an INSERT column list), which is
 * how a table shared by many features (organizations, platform_settings) is narrowed to one concern. Heuristic by design: it reads
 * source text, so a table name built at run time is invisible (none is, in apps/api/src).
 */
export function writesTable(source: string, table: string, column?: string): boolean {
  const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const re = new RegExp(
    `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b|\\.(insert|update|delete)\\(\\s*${camel}\\s*\\)`,
    'g',
  );
  for (const m of source.matchAll(re)) {
    if (!column) return true;
    const tail = source.slice(m.index, m.index + 600);
    if (new RegExp(`\\b${column}\\b`).test(tail)) return true;
  }
  return false;
}

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
    }
  })(root);
  return out;
}

/** Paths relative to `root`, sorted. */
export function writersOf(root: string, table: string, column?: string): string[] {
  return listSourceFiles(root)
    .filter((f) => writesTable(readFileSync(f, 'utf8'), table, column))
    .map((f) => relative(root, f))
    .sort();
}

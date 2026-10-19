/**
 * Which tables and columns the tool writes WITHOUT going through a TableSpec: the hand-written INSERT / UPDATE statements in load/ and
 * transform/. They are parsed from the source (this file is never bundled); the result is checked in as raw-writes.json, which the
 * bundle embeds, and test/raw-writes.spec.ts fails when the source and the JSON disagree. Regenerate: `tsx pilot/staging/raw-writes.ts`.
 * The spec-driven tables (STEPS[*].tables) are read from the code at run time and are not listed here.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** sql: table -> literal columns of hand-written statements; specs: table -> `module:CONST` of a TableSpec used by a direct insertRows call */
export interface RawWrites {
  sql: Record<string, string[]>;
  specs: Record<string, string>;
}
const TOOL = resolve(__dirname, '../..');
const DIRS = ['load', 'transform'];

/** The text between the '(' at `open` and its matching ')'. */
function balanced(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s.slice(open + 1, i);
  }
  return '';
}

function columnsOf(list: string, file: string): string[] {
  const only = /^\s*\$\{sql\.raw\((\w+)\)\}\s*$/.exec(list);
  if (only) {
    const c = new RegExp(`const ${only[1]}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`).exec(file);
    if (!c) throw new Error(`raw-writes: cannot resolve the column constant ${only[1]}`);
    return c[1]!.split(',').map((x) => x.trim());
  }
  // top-level items; an item with ${...} is dynamic (it comes from a TableSpec) and is skipped
  return list
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^[a-z_][a-z0-9_]*$/.test(x));
}

export function scanRawWrites(root: string = TOOL): RawWrites {
  const out: Record<string, Set<string>> = {};
  const specs: Record<string, string> = {};
  const add = (t: string, cols: string[]): void => {
    if (t.startsWith('migration.')) return; // the tool's own schema is check (g)
    const set = (out[t] ??= new Set());
    for (const c of cols) set.add(c);
  };
  for (const d of DIRS) {
    for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(root, d, f), 'utf8');
      for (const m of src.matchAll(/INSERT INTO ([a-z_][a-z0-9_.]*)\s*\(/g)) {
        add(m[1]!, columnsOf(balanced(src, m.index! + m[0].length - 1), src));
      }
      for (const m of src.matchAll(
        /\bUPDATE ([a-z_][a-z0-9_.]*)(?:\s+[a-z][a-z0-9_]*)?\s+SET\b([^`]*?)(?:WHERE|`)/gs,
      )) {
        add(
          m[1]!,
          [...m[2]!.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*=/g)].map((x) => x[1]!),
        );
      }
      for (const m of src.matchAll(
        /insertRows\(\s*tx,\s*[\w.]+,\s*'([a-z_]+)',\s*([A-Z][A-Z_]*)/g,
      )) {
        specs[m[1]!] = `${d}/${f.replace(/\.ts$/, '')}:${m[2]}`;
      }
      for (const m of src.matchAll(/DELETE FROM ([a-z_][a-z0-9_.]*)/g)) add(m[1]!, []);
    }
  }
  return {
    sql: Object.fromEntries(
      Object.keys(out)
        .sort()
        .map((t) => [t, [...out[t]!].sort()]),
    ),
    specs: Object.fromEntries(Object.entries(specs).sort()),
  };
}

if (require.main === module) {
  const w = scanRawWrites();
  writeFileSync(join(__dirname, 'raw-writes.json'), JSON.stringify(w, null, 2) + '\n');
  console.log(
    `raw-writes.json: ${Object.keys(w.sql).length} sql tables, ${Object.keys(w.specs).length} direct spec tables`,
  );
}

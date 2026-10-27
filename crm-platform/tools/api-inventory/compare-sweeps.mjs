// Sheet 3 D-02: ranks the statements of one measure.mjs run by total database time and, for a second run, says what happened to each.
//   node tools/api-inventory/compare-sweeps.mjs <before-dir> [<after-dir>] [--top 20]
// A <dir> is an `--out` folder of tools/api-inventory/measure.mjs (it reads <dir>/query-timings.json). Statements are matched by their
// normalised text (whitespace collapsed, first 160 characters), so a statement whose text changed counts as gone in the after run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = (q) => q.replace(/\s+/g, ' ').trim().slice(0, 160);

/** Per-statement rows ranked by total time, with each one's share of all database time and the running share. */
export function rank(timings) {
  const rows = [...timings].sort((a, b) => b.totalMs - a.totalMs);
  const totalMs = rows.reduce((a, r) => a + r.totalMs, 0);
  let run = 0;
  return {
    totalMs,
    calls: rows.reduce((a, r) => a + r.calls, 0),
    rows: rows.map((r) => ({
      key: key(r.query),
      calls: r.calls,
      meanMs: r.meanMs,
      maxMs: r.maxMs,
      totalMs: r.totalMs,
      share: totalMs ? r.totalMs / totalMs : 0,
      cumulative: totalMs ? (run += r.totalMs) / totalMs : 0,
    })),
  };
}

/** The top `n` of `before`, each with its mean in `after` (null = the statement no longer runs). */
export function compare(before, after, n = 20) {
  const b = rank(before);
  const a = after ? rank(after) : null;
  const byKey = new Map(a?.rows.map((r) => [r.key, r]));
  return {
    before: { totalMs: b.totalMs, calls: b.calls },
    after: a && { totalMs: a.totalMs, calls: a.calls },
    top: b.rows.slice(0, n).map((r, i) => {
      const o = byKey.get(r.key);
      return {
        rank: i + 1,
        ...r,
        afterMeanMs: a ? (o ? o.meanMs : null) : undefined,
        gone: a ? !o : undefined,
      };
    }),
  };
}

const load = (dir) => JSON.parse(readFileSync(join(dir, 'query-timings.json'), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((x) => !x.startsWith('--') && !/^\d+$/.test(x));
  const top = process.argv.includes('--top')
    ? Number(process.argv[process.argv.indexOf('--top') + 1])
    : 20;
  if (!args[0]) {
    console.error('usage: compare-sweeps.mjs <before-dir> [<after-dir>] [--top 20]');
    process.exit(2);
  }
  const r = compare(load(args[0]), args[1] ? load(args[1]) : null, top);
  const f = (n) => (n === null ? '   gone' : n.toFixed(1).padStart(7));
  console.log(
    `before: ${Math.round(r.before.totalMs)} ms over ${r.before.calls} calls` +
      (r.after ? `, after: ${Math.round(r.after.totalMs)} ms over ${r.after.calls} calls` : ''),
  );
  console.log(
    'rank  total ms  share  cum   calls   mean ms' + (r.after ? '  after ms' : '') + '  statement',
  );
  for (const t of r.top)
    console.log(
      `${String(t.rank).padStart(4)} ${String(Math.round(t.totalMs)).padStart(9)} ${(t.share * 100).toFixed(1).padStart(5)}% ${(t.cumulative * 100).toFixed(0).padStart(3)}% ${String(t.calls).padStart(7)} ${f(t.meanMs)}` +
        (r.after ? ` ${f(t.afterMeanMs)}` : '') +
        `  ${t.key.slice(0, 80)}`,
    );
}

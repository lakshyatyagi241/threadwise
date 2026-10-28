import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../../src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** Every `db.retry.<tx|txAs|privileged>(` / `db.retryIdem...(` call, with the source of its callback. */
function sites() {
  const out: Array<{ file: string; line: number; idem: boolean; body: string }> = [];
  const open = /\bdb\.(retry|retryIdem)\.(?:tx|txAs|privileged)\s*\(/g;
  for (const f of files(SRC)) {
    if (f.endsWith('database.service.ts')) continue;
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(open)) {
      let depth = 0;
      let end = m.index! + m[0].length - 1;
      for (; end < s.length; end++) {
        if (s[end] === '(') depth++;
        else if (s[end] === ')' && --depth === 0) break;
      }
      out.push({
        file: relative(SRC, f),
        line: s.slice(0, m.index).split('\n').length,
        idem: m[1] === 'retryIdem',
        body: s.slice(m.index! + m[0].length, end),
      });
    }
  }
  return out;
}

describe('transactions that opt in to a retry', () => {
  const all = sites();

  // The 20 reviewed in 10d7dd54a, plus the send hold (wallet-gate.service) and the AI-call hold (usage-billing.service): each only takes
  // a hold row (holdMinor), so a retry after a deadlock repeats nothing that was committed. Adding one is a deliberate change to this number.
  it('are the 22 reviewed write paths (adding one is a deliberate change to this number)', () => {
    expect(all.length).toBe(22);
  });

  it('never retry a dropped connection: none uses db.retryIdem (a repeat after a committed first run is unsafe at ingest and refund)', () => {
    expect(all.filter((s) => s.idem).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it('run no provider call, queue add, realtime publish or mail send inside the callback (it runs again on a retry)', () => {
    const effect =
      /\bfetch\(|\.sendMail\(|\bqueue\.add|\.addBulk\(|\.enqueue\w*\(|\bredis\.|this\.realtime\.|this\.hooks\.|\.publish\(|this\.provider\w*\.|this\.dispatcher\.|axios\b/;
    expect(all.filter((s) => effect.test(s.body)).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });
});

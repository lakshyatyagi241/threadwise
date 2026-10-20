import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writersOf, writesTable } from './writer-scan';

/**
 * Ratchet (item #66): every file that writes a table behind a cache must be listed in docs/performance/cache/invalidation-results.json
 * with how its change reaches the cache (`invalidates` + the call that must appear in the file or its service, `exempt` + reason, or
 * `ttl-only` + the open finding). A new writer of such a table, or a listed one that lost its call, fails here.
 */
const SRC = resolve(__dirname, '../../../src');
const FILE = resolve(__dirname, '../../../../../docs/performance/cache/invalidation-results.json');

interface Writer {
  d: 'invalidates' | 'exempt' | 'ttl-only';
  call?: string;
  via?: string;
  reason?: string;
}
interface Entry {
  id: string;
  table: string;
  column?: string;
  cache: string;
  writers: Record<string, Writer>;
}
const entries = (JSON.parse(readFileSync(FILE, 'utf8')) as { ratchet: Entry[] }).ratchet;
const text = (f: string) => readFileSync(resolve(SRC, f), 'utf8');

describe('every writer of a cached source is covered', () => {
  for (const e of entries) {
    it(`${e.id}: ${e.table}${e.column ? '.' + e.column : ''} (${e.cache})`, () => {
      const found = writersOf(SRC, e.table, e.column);
      const declared = Object.keys(e.writers).sort();
      expect(
        found.filter((f) => !declared.includes(f)),
        'writer not in invalidation-results.json: add its invalidation or an exemption with a reason',
      ).toEqual([]);
      expect(
        declared.filter((f) => !found.includes(f)),
        'listed writer no longer writes the table: remove it from the list',
      ).toEqual([]);
      for (const [file, w] of Object.entries(e.writers)) {
        if (w.d === 'invalidates') {
          const body = text(w.via ?? file);
          expect(body.includes(w.call!), `${w.via ?? file} must contain ${w.call}`).toBe(true);
        } else {
          expect(w.reason, `${file} needs a written reason`).toBeTruthy();
        }
      }
    });
  }

  it("the scanner sees a bad example: a new writer that is in nobody's list", () => {
    const bad = 'await tx.execute(sql`UPDATE user_roles SET role_id = ${r} WHERE user_id = ${u}`);';
    expect(writesTable(bad, 'user_roles')).toBe(true);
    expect(writesTable('tx.insert(userRoles).values(x)', 'user_roles')).toBe(true);
    expect(writesTable('SELECT * FROM user_roles', 'user_roles')).toBe(false);
    expect(
      writesTable("UPDATE organizations SET name = 'x' WHERE id = 1", 'organizations', 'status'),
    ).toBe(false);
    expect(
      writesTable("UPDATE organizations SET status = 'x' WHERE id = 1", 'organizations', 'status'),
    ).toBe(true);
    // and the check itself: a writer file missing from the declared list is reported
    const found = ['a.ts', 'new-writer.ts'];
    const declared = ['a.ts'];
    expect(found.filter((f) => !declared.includes(f))).toEqual(['new-writer.ts']);
  });
});

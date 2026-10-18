import { describe, expect, it } from 'vitest';
import { WMIG_CLIENT_RE, deriveClientKey } from '@crm/contracts';
import { parseOrgIds } from './org-ids';
import { localToIso, runAtProblem } from './run-at';

describe('parseOrgIds (bulk textarea)', () => {
  it('reads one id per line, ignores blank lines, keeps order', () => {
    expect(parseOrgIds('a1\n\n  b2  \nc_3\n')).toMatchObject({
      ids: ['a1', 'b2', 'c_3'],
      ok: true,
    });
  });
  it('flags invalid ids, duplicates and ids that derive the same client key', () => {
    const p = parseOrgIds('ok1\nbad-id\nok1\nAbC\naBc\nx;y');
    expect(p.invalid).toEqual(['bad-id', 'x;y']);
    expect(p.duplicates).toEqual(['ok1']);
    expect(p.collisions).toEqual(['aBc']);
    expect(p.ok).toBe(false);
  });
  it('accepts a plus sign and derives a client key without it', () => {
    const p = parseOrgIds('support+demo_XXKhXNvA_y8tj');
    expect(p).toMatchObject({ ids: ['support+demo_XXKhXNvA_y8tj'], ok: true });
    expect(deriveClientKey('support+demo_XXKhXNvA_y8tj')).toBe('support-demo_xxkhxnva_y8tj');
    expect(WMIG_CLIENT_RE.test(deriveClientKey('a+b'.repeat(40)))).toBe(true);
  });
  it('allows at most 50 organizations and needs at least one', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `org${i}`).join('\n');
    expect(parseOrgIds(ids(50)).ok).toBe(true);
    expect(parseOrgIds(ids(51))).toMatchObject({ tooMany: true, ok: false });
    expect(parseOrgIds('  \n ').ok).toBe(false);
  });
});

describe('run at', () => {
  const NOW = new Date('2026-10-13T12:00:00Z');
  it('is optional, must be in the future and at most 90 days ahead', () => {
    expect(runAtProblem('', NOW)).toBeNull();
    expect(runAtProblem('2026-10-13T11:00', new Date('2026-10-13T12:00:00'))).toBe('past');
    expect(runAtProblem('nope', NOW)).toBe('invalid');
    expect(runAtProblem('2026-11-01T10:00', new Date('2026-10-13T12:00:00'))).toBeNull();
    expect(runAtProblem('2027-06-01T10:00', new Date('2026-10-13T12:00:00'))).toBe('tooFar');
  });
  it('turns a local date-time into an ISO instant', () => {
    expect(localToIso('')).toBeNull();
    expect(localToIso('2026-10-13T12:00')).toMatch(/^2026-10-1[23]T\d\d:\d\d:00\.000Z$/);
  });
});

import { describe, expect, it } from 'vitest';
import { pickOwner } from '../../../src/modules/leads/lead-assignment';
import {
  generateLeadToken,
  hashLeadToken,
  leadTokenHint,
  looksLikeLeadToken,
  secretMatches,
} from '../../../src/modules/leads/lead-token';

describe('pickOwner (L-07)', () => {
  const users = ['ana', 'ben', 'cy'];

  it('unassigned picks nobody and leaves the cursor', () => {
    expect(pickOwner({ mode: 'unassigned' }, users, 4)).toEqual({ pick: null, nextCursor: 4 });
  });

  it('fixed picks the one user and leaves the cursor', () => {
    expect(pickOwner({ mode: 'fixed' }, ['ana'], 9)).toEqual({ pick: 'ana', nextCursor: 9 });
  });

  it('nobody can take the lead when no listed user is active', () => {
    expect(pickOwner({ mode: 'round_robin' }, [], 3)).toEqual({ pick: null, nextCursor: 3 });
    expect(pickOwner({ mode: 'fixed' }, [], 0).pick).toBeNull();
  });

  it('round robin walks the list in order and wraps', () => {
    const picks: string[] = [];
    let cursor = 0;
    for (let i = 0; i < 7; i++) {
      const r = pickOwner({ mode: 'round_robin' }, users, cursor);
      picks.push(r.pick!);
      cursor = r.nextCursor;
    }
    expect(picks).toEqual(['ana', 'ben', 'cy', 'ana', 'ben', 'cy', 'ana']);
  });

  it('a user who drops out of the rotation is skipped without stalling it', () => {
    // cursor 4 over three users points at ben; with ana gone it points at (4 % 2) = ana-of-the-remaining.
    expect(pickOwner({ mode: 'round_robin' }, ['ben', 'cy'], 4).pick).toBe('ben');
    expect(pickOwner({ mode: 'round_robin' }, ['ben', 'cy'], 5).pick).toBe('cy');
  });

  it('fairness: over many leads each of n users gets within one lead of the others', () => {
    const counts = new Map<string, number>();
    let cursor = 0;
    for (let i = 0; i < 100; i++) {
      const r = pickOwner({ mode: 'round_robin' }, users, cursor);
      counts.set(r.pick!, (counts.get(r.pick!) ?? 0) + 1);
      cursor = r.nextCursor;
    }
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });
});

describe('lead hook token (L-04)', () => {
  it('is 43 url-safe characters, unique, and recognised as a token', () => {
    const a = generateLeadToken();
    const b = generateLeadToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(looksLikeLeadToken(a)).toBe(true);
    expect(looksLikeLeadToken('short')).toBe(false);
    expect(looksLikeLeadToken(`${a}!`)).toBe(false);
    expect(looksLikeLeadToken('')).toBe(false);
  });

  it('only a hash is stored: deterministic, hex, and not the token', () => {
    const t = generateLeadToken();
    const h = hashLeadToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashLeadToken(t));
    expect(h).not.toContain(t);
    expect(hashLeadToken(`${t}x`)).not.toBe(h);
  });

  it('the hint is the last four characters, enough to tell two URLs apart and nothing more', () => {
    const t = generateLeadToken();
    expect(leadTokenHint(t)).toBe(t.slice(-4));
    expect(leadTokenHint(t)).toHaveLength(4);
  });
});

describe('secretMatches', () => {
  it('matches the same secret and nothing else, whatever the length', () => {
    expect(secretMatches('s3cret-value!', 's3cret-value!')).toBe(true);
    expect(secretMatches('s3cret-value?', 's3cret-value!')).toBe(false);
    expect(secretMatches('s', 's3cret-value!')).toBe(false);
    expect(secretMatches('s3cret-value!extra', 's3cret-value!')).toBe(false);
    expect(secretMatches(undefined, 's3cret-value!')).toBe(false);
    expect(secretMatches('', 's3cret-value!')).toBe(false);
  });
});

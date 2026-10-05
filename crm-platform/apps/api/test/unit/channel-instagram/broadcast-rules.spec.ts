import { describe, expect, it } from 'vitest';
import {
  CONCURRENCY,
  accountThreadPatterns,
  chunk,
  clipError,
  composerBody,
  likeEscape,
  personalize,
  windowOpen,
} from '../../../src/modules/channel-instagram/broadcast-rules';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/** What Postgres' LIKE does with a pattern, with `\` as the escape: enough to check the account patterns. */
const like = (value: string, pattern: string): boolean => {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 's').test(value);
};

describe('the message for one person (WD-IG-014)', () => {
  it('{name} becomes the thread title in every place, or "there" when there is none', () => {
    expect(personalize('Hi {name}, {name}!', 'Asha')).toBe('Hi Asha, Asha!');
    expect(personalize('Hi {name}', '')).toBe('Hi there');
    expect(personalize('Hi {name}', null)).toBe('Hi there');
    expect(personalize('No placeholder', 'Asha')).toBe('No placeholder');
  });

  it('the composer’s template wins when it has a body, else the typed text stays', () => {
    expect(composerBody('typed', { body: 'from template' })).toBe('from template');
    expect(composerBody('typed', { body: '   ' })).toBe('typed');
    expect(composerBody('typed', undefined)).toBe('typed');
  });
});

describe('the 24 hour window (WD-IG-013)', () => {
  it('is open within 24 hours of the person’s last message and closed after, or with none', () => {
    expect(windowOpen(hoursAgo(1), NOW)).toBe(true);
    expect(windowOpen(hoursAgo(23.9), NOW)).toBe(true);
    expect(windowOpen(hoursAgo(24), NOW)).toBe(false);
    expect(windowOpen(hoursAgo(30), NOW)).toBe(false);
    expect(windowOpen(null, NOW)).toBe(false);
  });
});

describe('which threads belong to an account', () => {
  it('escapes the characters LIKE treats as wildcards', () => {
    expect(likeEscape('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
  });

  it('matches either separator, and an account id with an underscore matches only itself', () => {
    const matches = (account: string, key: string) =>
      accountThreadPatterns(account).some((p) => like(key, p));
    expect(matches('A1', 'ig:A1_555')).toBe(true);
    expect(matches('A1', 'ig:A1:555')).toBe(true);
    expect(matches('A_1', 'ig:A_1_555')).toBe(true);
    expect(matches('A_1', 'ig:AX1_555')).toBe(false);
  });

  it('account 1 does not claim the threads of account 12 (the old single wildcard did)', () => {
    const matches = (account: string, key: string) =>
      accountThreadPatterns(account).some((p) => like(key, p));
    expect(matches('1', 'ig:12_555')).toBe(false);
    expect(matches('1', 'ig:12:555')).toBe(false);
    expect(matches('12', 'ig:12_555')).toBe(true);
    expect(matches('1', 'ig:1_555')).toBe(true);
  });
});

describe('small helpers', () => {
  it('cuts an error to 120 characters', () => {
    expect(clipError('x'.repeat(300))).toHaveLength(120);
    expect(clipError('short')).toBe('short');
  });

  it('splits a list into groups of the given size, keeping order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(
      chunk(
        Array.from({ length: 12 }, (_, i) => i),
        CONCURRENCY,
      ).map((g) => g.length),
    ).toEqual([5, 5, 2]);
  });
});

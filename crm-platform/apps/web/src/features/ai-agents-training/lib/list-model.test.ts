import { describe, expect, it } from 'vitest';
import {
  accentFor,
  matchesSearch,
  matchesStatus,
  providerPill,
  relativeShort,
  statCards,
} from './list-model';

describe('stat cards (WD-AIAG-001)', () => {
  it('derives paused, the average and the health label', () => {
    expect(statCards({ all: 4, active: 3, sources: 10, ready: 8 })).toMatchObject({
      paused: 1,
      avgPerAgent: '2.5',
      healthPct: 75,
      health: 'attention',
    });
    expect(statCards({ all: 2, active: 2, sources: 0, ready: 0 })).toMatchObject({
      health: 'healthy',
      healthPct: 100,
    });
  });

  it('an empty workspace is "empty" with a zero average, not NaN', () => {
    expect(statCards({ all: 0, active: 0, sources: 0, ready: 0 })).toMatchObject({
      avgPerAgent: '0',
      healthPct: 0,
      health: 'empty',
    });
  });
});

describe('the list filters', () => {
  it('search matches name or slug, case-insensitively, and blank matches all', () => {
    const a = { name: 'Pricing Concierge', slug: 'pricing-concierge' };
    expect(matchesSearch(a, 'CONCI')).toBe(true);
    expect(matchesSearch(a, 'pricing-c')).toBe(true);
    expect(matchesSearch(a, 'refund')).toBe(false);
    expect(matchesSearch(a, '  ')).toBe(true);
  });

  it('the status view keeps the matching rows', () => {
    expect(matchesStatus({ status: 'paused' }, 'all')).toBe(true);
    expect(matchesStatus({ status: 'paused' }, 'active')).toBe(false);
    expect(matchesStatus({ status: 'paused' }, 'paused')).toBe(true);
  });
});

describe('row look', () => {
  it('an unknown provider gets the first provider tint', () => {
    expect(providerPill('mistral')).toBe(providerPill('openai'));
    expect(providerPill('gemini')).not.toBe(providerPill('openai'));
  });

  it('the accent cycles on the first hex digit of the id', () => {
    expect(accentFor('0abc')).toBe(accentFor('4abc'));
    expect(accentFor('0abc')).not.toBe(accentFor('1abc'));
  });

  it('relative time is short', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(relativeShort('2026-10-07T11:59:58Z', now)).toBe('2s ago');
    expect(relativeShort('2026-10-07T09:00:00Z', now)).toBe('3h ago');
    expect(relativeShort('2026-09-30T12:00:00Z', now)).toBe('1w ago');
  });
});

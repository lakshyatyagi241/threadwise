import { describe, expect, it } from 'vitest';
import {
  canDelete,
  parseState,
  providerLabel,
  providerTag,
  reference,
  scheduleText,
  statusLabel,
  statusTone,
  stateToSearch,
  totalPages,
} from './list-model';

describe('list state in the address', () => {
  it('reads defaults from an empty address and ignores bad values', () => {
    expect(parseState(new URLSearchParams(''))).toEqual({
      status: 'all',
      range: 'all',
      q: '',
      page: 1,
    });
    expect(parseState(new URLSearchParams('range=2y&page=-3&q=%20'))).toMatchObject({
      range: 'all',
      page: 1,
      q: '',
    });
  });

  it('round trips, writing only what differs', () => {
    const s = { status: 'failed', range: '30d' as const, q: 'diwali', page: 3 };
    expect(parseState(new URLSearchParams(stateToSearch(s)))).toEqual(s);
    expect(stateToSearch({ status: 'all', range: 'all', q: '', page: 1 })).toBe('');
  });

  it('counts pages, at least one', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(12)).toBe(1);
    expect(totalPages(13)).toBe(2);
  });
});

describe('labels', () => {
  it('title-cases a status, and tones follow Reference', () => {
    expect(statusLabel('completed_with_errors')).toBe('Completed With Errors');
    expect(statusTone('completed')).toBe('solid');
    expect(statusTone('scheduled')).toBe('warning');
    expect(statusTone('processing')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('paused')).toBe('neutral');
  });

  it('names the engine, with a dash for none', () => {
    expect(providerLabel('baileys')).toBe('Unofficial API');
    expect(providerLabel('WABA')).toBe('WABA');
    expect(providerLabel(null)).toBe('—');
  });

  it('tags a broadcast of the unofficial engine as disabled while the platform switch is off', () => {
    const off = 'Unofficial (disabled)';
    expect(providerTag('baileys', false, off)).toBe(off);
    expect(providerTag('BAILEYS', false, off)).toBe(off);
    expect(providerTag('baileys', true, off)).toBe('Unofficial API');
    expect(providerTag('waba', false, off)).toBe('WABA');
    expect(providerTag(null, false, off)).toBe('—');
  });

  it('only scheduled and failed broadcasts can be deleted', () => {
    expect(['scheduled', 'failed', 'processing', 'completed', 'paused'].filter(canDelete)).toEqual([
      'scheduled',
      'failed',
    ]);
  });

  it('the reference is the start of the uuid', () => {
    expect(reference('abcdef12-0000-4000-8000-000000000000')).toBe('BR-ABCDEF12');
  });
});

describe('schedule text', () => {
  const now = new Date(2026, 9, 2, 9, 0);
  it('says Today for today and the date otherwise; null for none', () => {
    expect(scheduleText(new Date(2026, 9, 2, 14, 5).toISOString(), now, 'Today')).toBe(
      'Today, 14:05',
    );
    expect(scheduleText(new Date(2026, 9, 3, 8, 0).toISOString(), now, 'Today')).toBe(
      'Oct 03, 08:00',
    );
    expect(scheduleText(null, now, 'Today')).toBeNull();
  });
  it('reads the same instant in the zone it is given', () => {
    const iso = '2026-10-02T20:30:00Z';
    const base = new Date('2026-10-02T09:00:00Z');
    expect(scheduleText(iso, base, 'Today', 'Asia/Kolkata')).toBe('Oct 03, 02:00');
    expect(scheduleText(iso, base, 'Today', 'America/New_York')).toBe('Today, 16:30');
  });
});

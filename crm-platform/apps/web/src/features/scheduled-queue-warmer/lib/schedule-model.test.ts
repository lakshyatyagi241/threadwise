import { describe, expect, it } from 'vitest';
import type { ScheduleSummary } from '@crm/contracts';
import {
  availableActions,
  funnelOf,
  parseState,
  recipientTabMatches,
  relativeWhen,
  stateToSearch,
  statusTone,
  totalPages,
  totalsOf,
} from './schedule-model';

const row = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({
  id: 'abcdef12-0000-4000-8000-000000000000',
  name: 'Spring',
  status: 'completed',
  scheduleType: 'once',
  recipientType: 'group',
  messageType: 'plain',
  senderLabel: null,
  provider: null,
  scheduledAt: '2026-10-10T10:00:00.000Z',
  nextRunAt: null,
  lastRunAt: null,
  timezone: 'UTC',
  repeatInterval: null,
  totalRecipients: 10,
  totalSent: 10,
  totalDelivered: 8,
  totalFailed: 0,
  lastError: null,
  rowVersion: 1,
  ...over,
});

describe('list state in the address', () => {
  it('reads defaults and ignores bad values', () => {
    expect(parseState(new URLSearchParams(''))).toEqual({ tab: 'all', q: '', page: 1 });
    expect(parseState(new URLSearchParams('tab=nope&page=-2&q=%20'))).toEqual({
      tab: 'all',
      q: '',
      page: 1,
    });
  });
  it('round trips, writing only what differs', () => {
    const s = { tab: 'failed' as const, q: 'spring', page: 3 };
    expect(parseState(new URLSearchParams(stateToSearch(s)))).toEqual(s);
    expect(stateToSearch({ tab: 'all', q: '', page: 1 })).toBe('');
  });
  it('counts pages, at least one', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(25)).toBe(1);
    expect(totalPages(26)).toBe(2);
  });
});

describe('status and actions', () => {
  it('tones the pills', () => {
    expect(statusTone('scheduled')).toBe('success');
    expect(statusTone('paused')).toBe('warning');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('completed')).toBe('neutral');
  });
  it('offers the actions the reference offers per status', () => {
    expect(availableActions('scheduled')).toMatchObject({
      pause: true,
      resume: false,
      runNow: true,
      cancel: true,
      retry: false,
    });
    expect(availableActions('running')).toMatchObject({ pause: true, cancel: true });
    expect(availableActions('paused')).toMatchObject({
      pause: false,
      resume: true,
      runNow: true,
      cancel: true,
    });
    expect(availableActions('failed')).toMatchObject({ retry: true, runNow: false, cancel: false });
    expect(availableActions('completed')).toMatchObject({
      retry: false,
      runNow: false,
      delete: true,
    });
    expect(availableActions('cancelled').delete).toBe(true);
  });
});

describe('relative time', () => {
  const now = Date.UTC(2026, 9, 10, 10, 0);
  it('words the distance', () => {
    expect(relativeWhen(now - 60_000, now).key).toBe('overdue');
    expect(relativeWhen(now + 10_000, now).key).toBe('now');
    expect(relativeWhen(now + 12 * 60_000, now)).toEqual({ key: 'minutes', n: 12 });
    expect(relativeWhen(now + 3 * 3600_000, now)).toEqual({ key: 'hours', n: 3 });
    expect(relativeWhen(now + 30 * 3600_000, now).key).toBe('tomorrow');
    expect(relativeWhen(now + 80 * 3600_000, now).key).toBe('date');
  });
});

describe('totals', () => {
  it('sums sent and rates delivery over completed schedules only', () => {
    const t = totalsOf([
      row(),
      row({ totalSent: 10, totalDelivered: 10 }),
      row({ status: 'scheduled', totalSent: 5, totalDelivered: 0 }),
    ]);
    expect(t.totalSent).toBe(25);
    expect(t.deliveryRate).toBe(90);
    expect(totalsOf([]).deliveryRate).toBe(0);
  });
});

describe('recipient tabs and funnel', () => {
  it('"sent" includes delivered and read; "delivered" includes read', () => {
    expect(recipientTabMatches('sent', 'read')).toBe(true);
    expect(recipientTabMatches('delivered', 'sent')).toBe(false);
    expect(recipientTabMatches('delivered', 'read')).toBe(true);
    expect(recipientTabMatches('pending', 'processing')).toBe(true);
    expect(recipientTabMatches('failed', 'sent')).toBe(false);
    expect(recipientTabMatches('all', 'whatever')).toBe(true);
  });
  it('counts the funnel as the reference does', () => {
    const f = funnelOf({ pending: 2, sent: 3, delivered: 3, read: 2, failed: 1 }, 11);
    expect(f).toMatchObject({ all: 11, sent: 8, delivered: 5, read: 2, failed: 1, pending: 2 });
    expect(f.deliveryRate).toBe(62.5);
    expect(f.readRate).toBe(25);
    expect(f.failRate).toBe(9.1);
    expect(f.progressPct).toBe(72.7);
  });
  it('has no rates before anything was sent', () => {
    expect(funnelOf({}, 0)).toMatchObject({ all: 0, deliveryRate: 0, progressPct: 0 });
  });
});

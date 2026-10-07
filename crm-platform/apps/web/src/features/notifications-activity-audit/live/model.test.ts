import { describe, expect, it } from 'vitest';
import type { NotificationListResponse } from '@crm/contracts';
import {
  TOAST_PER_SUBJECT_MS,
  TOAST_WINDOW_MAX,
  TOAST_WINDOW_MS,
  ToastPlanner,
  feedAfterRead,
  formatTitle,
  isOnConversation,
  newestBy,
  newestPerSubject,
  stripTitleBadge,
  unreadFrom,
} from './model';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const row = (id: string, readAt: string | null = null) => ({
  id,
  type: 'new_message',
  title: 't',
  body: null,
  link: null,
  data: null,
  readAt,
  createdAt: '2026-10-07T10:00:00.000Z',
});
const feed = (rows = [row(A), row(B), row(C, '2026-10-07T09:00:00.000Z')], unread = 2) =>
  ({
    data: rows,
    page: { nextCursor: null, hasMore: false, limit: 8 },
    meta: { unread },
  }) as NotificationListResponse;

describe('feedAfterRead (notification.read to the cached list)', () => {
  const NOW = '2026-10-07T12:00:00.000Z';

  it('marks the named rows read and takes the server total', () => {
    const next = feedAfterRead(feed(), { unread: 1, notificationIds: [A] }, NOW)!;
    expect(next.data.map((n) => n.readAt)).toEqual([NOW, null, '2026-10-07T09:00:00.000Z']);
    expect(next.meta.unread).toBe(1);
  });

  it('marks every unread row for "all", keeping the earlier read time of rows already read', () => {
    const next = feedAfterRead(feed(), { unread: 0, notificationIds: 'all' }, NOW)!;
    expect(next.data.map((n) => n.readAt)).toEqual([NOW, NOW, '2026-10-07T09:00:00.000Z']);
    expect(next.meta.unread).toBe(0);
  });

  it('returns the same object when nothing changes (no needless render) and tolerates no cache', () => {
    const f = feed([row(A, 'x')], 0);
    expect(feedAfterRead(f, { unread: 0, notificationIds: [B] }, NOW)).toBe(f);
    expect(feedAfterRead(undefined, { unread: 0, notificationIds: 'all' }, NOW)).toBeUndefined();
  });

  it('ignores ids that are not in the cached page but still takes the total', () => {
    const next = feedAfterRead(feed(), { unread: 7, notificationIds: [C] }, NOW)!;
    expect(next.data.map((n) => n.readAt)).toEqual([null, null, '2026-10-07T09:00:00.000Z']);
    expect(next.meta.unread).toBe(7);
  });
});

describe('unreadFrom', () => {
  it('is the server number, never negative or fractional', () => {
    expect(unreadFrom({ unread: 5 })).toBe(5);
    expect(unreadFrom({ unread: -2 })).toBe(0);
    expect(unreadFrom({ unread: 3.7 })).toBe(3);
  });
});

describe('isOnConversation (the person is looking at it)', () => {
  it('is true for the Inbox with that thread open, in any letter case', () => {
    expect(isOnConversation({ pathname: '/inbox', search: `?c=${A}` }, A)).toBe(true);
    expect(isOnConversation({ pathname: '/inbox', search: `?c=${A.toUpperCase()}` }, A)).toBe(true);
    expect(isOnConversation({ pathname: '/inbox', search: `?tab=mine&c=${A}` }, A)).toBe(true);
  });
  it('is false for another thread, no thread, another page or no id', () => {
    expect(isOnConversation({ pathname: '/inbox', search: `?c=${B}` }, A)).toBe(false);
    expect(isOnConversation({ pathname: '/inbox', search: '' }, A)).toBe(false);
    expect(isOnConversation({ pathname: '/contacts', search: `?c=${A}` }, A)).toBe(false);
    expect(isOnConversation({ pathname: '/inbox', search: `?c=${A}` }, null)).toBe(false);
  });
});

describe('tab title badge', () => {
  it('puts the count in front, caps it at 99+, and removes it at zero', () => {
    expect(formatTitle('Inbox', 3)).toBe('(3) Inbox');
    expect(formatTitle('Inbox', 100)).toBe('(99+) Inbox');
    expect(formatTitle('Inbox', 0)).toBe('Inbox');
  });
  it('replaces a badge that is already there instead of stacking', () => {
    expect(formatTitle('(3) Inbox', 4)).toBe('(4) Inbox');
    expect(formatTitle('(99+) Inbox', 0)).toBe('Inbox');
    expect(stripTitleBadge('(12) Contacts | CRM')).toBe('Contacts | CRM');
  });
  it('leaves a title that merely starts with a number in brackets word', () => {
    expect(stripTitleBadge('(beta) Inbox')).toBe('(beta) Inbox');
  });
});

describe('newestBy', () => {
  it('keeps the last item per key, ordered by when the key last appeared', () => {
    const events = [
      { subjectId: A, type: 'new_message', n: 1 },
      { subjectId: B, type: 'new_message', n: 2 },
      { subjectId: A, type: 'new_message', n: 3 },
      { subjectId: null, type: 'mention', n: 4 },
    ];
    expect(newestPerSubject(events).map((e) => e.n)).toEqual([2, 3, 4]);
    expect(newestBy([1, 2, 3, 4], (x) => String(x % 2))).toEqual([3, 4]);
  });
});

describe('ToastPlanner', () => {
  it('shows the first toast of a conversation and defers one inside the window to its end', () => {
    const p = new ToastPlanner();
    expect(p.decide(A, 0)).toEqual({ action: 'show' });
    p.record(A, 0);
    expect(p.decide(A, 1_000)).toEqual({ action: 'defer', waitMs: TOAST_PER_SUBJECT_MS - 1_000 });
    expect(p.decide(A, TOAST_PER_SUBJECT_MS)).toEqual({ action: 'show' });
  });

  it('paces conversations independently', () => {
    const p = new ToastPlanner();
    p.record(A, 0);
    expect(p.decide(B, 100)).toEqual({ action: 'show' });
  });

  it('folds toasts beyond the window cap into an overflow, until the oldest leaves the window', () => {
    const p = new ToastPlanner();
    const subjects = ['s1', 's2', 's3', 's4'];
    for (let i = 0; i < TOAST_WINDOW_MAX; i++) p.record(subjects[i]!, i * 100);
    expect(p.decide('s4', 500)).toEqual({ action: 'overflow', waitMs: TOAST_WINDOW_MS - 500 });
    expect(p.decide('s4', TOAST_WINDOW_MS)).toEqual({ action: 'show' });
  });

  it('forgets old conversations so memory stays bounded', () => {
    const p = new ToastPlanner();
    for (let i = 0; i < 250; i++) p.record(`s${i}`, i);
    p.record('late', 100_000);
    expect(p.decide('s0', 100_001)).toEqual({ action: 'show' });
  });
});

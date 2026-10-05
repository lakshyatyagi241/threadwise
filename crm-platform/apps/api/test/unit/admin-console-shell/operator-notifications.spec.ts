import { describe, expect, it } from 'vitest';
import { bellBadge } from '@crm/contracts';
import {
  matchesQuery,
  merge,
  money,
  seenAt,
  type FeedRow,
} from '../../../src/modules/admin-console-shell/operator-notification-rules';

const at = (iso: string) => new Date(iso);
const row = (over: Partial<FeedRow>): FeedRow => ({
  type: 'signup',
  uuid: 'u1',
  at: at('2026-10-01T10:00:00Z'),
  a: 'Ana',
  b: 'ana@example.test',
  ...over,
});

describe('operator notification feed rules (WD-ASHELL-006)', () => {
  it('shows 99+ above ninety-nine and nothing at zero', () => {
    expect(bellBadge(120)).toBe('99+');
    expect(bellBadge(99)).toBe('99');
    expect(bellBadge(0)).toBeNull();
  });

  it('lists newest first, caps the list, and marks only events newer than the marker as unread', () => {
    const seen = at('2026-10-01T09:00:00Z');
    const rows = [
      row({ uuid: 'old', at: at('2026-09-30T00:00:00Z') }),
      row({ uuid: 'new', at: at('2026-10-02T00:00:00Z') }),
      row({ uuid: 'mid', at: at('2026-10-01T10:00:00Z') }),
    ];
    const out = merge(rows, seen, 2);
    expect(out.map((n) => n.id)).toEqual(['signup-new', 'signup-mid']);
    expect(out.every((n) => n.unread)).toBe(true);
    expect(merge(rows, at('2026-10-03T00:00:00Z'), 3).some((n) => n.unread)).toBe(false);
  });

  it('words a paid order as a payment and an open one as an order, with the amount to two decimals', () => {
    const paid = merge(
      [row({ type: 'payment', a: '#ORD-1', b: money('USD', '49.9000'), paid: true })],
      at('2030-01-01'),
      5,
    )[0]!;
    expect(paid).toMatchObject({
      titleKey: 'paymentReceived',
      ref: '#ORD-1',
      message: 'USD 49.90',
      severity: 'success',
    });
    const open = merge(
      [row({ type: 'payment', a: '#ORD-2', b: null, paid: false })],
      at('2030-01-01'),
      5,
    )[0]!;
    expect(open).toMatchObject({ titleKey: 'newOrder', severity: 'info' });
  });

  it('joins name and email for a signup and leaves out an empty topic', () => {
    expect(merge([row({})], at('2030-01-01'), 1)[0]!.message).toBe('Ana · ana@example.test');
    expect(
      merge([row({ type: 'contact', a: 'Bo', b: null })], at('2030-01-01'), 1)[0]!.message,
    ).toBe('Bo');
  });

  it('filters the page by headline, order number or detail, ignoring case', () => {
    const titles = {
      signup: 'New signup',
      paymentReceived: 'Payment received',
      newOrder: 'New order',
      newTicket: 'New support ticket',
      newContactMessage: 'New contact message',
      newWorkspace: 'New workspace',
    };
    const n = merge([row({})], at('2030-01-01'), 1)[0]!;
    expect(matchesQuery(n, titles, 'ANA')).toBe(true);
    expect(matchesQuery(n, titles, 'new signup')).toBe(true);
    expect(matchesQuery(n, titles, 'nobody')).toBe(false);
    expect(matchesQuery(n, titles, undefined)).toBe(true);
  });

  it('treats a first-time operator as having last looked 14 days ago, and ignores a corrupt marker', () => {
    const now = at('2026-10-15T00:00:00Z');
    expect(seenAt(undefined, now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(seenAt('garbage', now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(seenAt('2026-10-10T00:00:00Z', now).toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });
});

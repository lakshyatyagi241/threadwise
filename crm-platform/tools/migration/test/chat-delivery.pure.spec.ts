import { describe, expect, it } from 'vitest';
import { classifyDelivery, mergeReceipts, receiptOf, type Receipt } from '../inbox/delivery';

const d = (s: string): Date => new Date(s);

describe('receiptOf: the furthest step of a billing-log row', () => {
  it('only sent stays sent', () => {
    expect(receiptOf({ message_id: 'w1', status: { sent: d('2026-07-27T10:00:00Z') } })).toMatchObject({
      wamid: 'w1',
      status: 'sent',
      deliveredAt: null,
      readAt: null,
    });
  });
  it('delivered, seen, replied', () => {
    const base = { sent: d('2026-07-27T10:00:00Z') };
    expect(receiptOf({ message_id: 'w', status: { ...base, delivered: d('2026-07-27T10:00:05Z') } })).toMatchObject({
      status: 'delivered',
      deliveredAt: '2026-07-27T10:00:05.000Z',
    });
    expect(receiptOf({ message_id: 'w', status: { ...base, delivered: d('2026-07-27T10:00:05Z'), seen: d('2026-07-27T10:01:00Z') } })).toMatchObject({
      status: 'read',
      readAt: '2026-07-27T10:01:00.000Z',
    });
    // a reply with no seen step still proves it was read, and delivered
    expect(receiptOf({ message_id: 'w', status: { ...base, replied: d('2026-10-08T09:00:00Z') } })).toMatchObject({
      status: 'read',
      readAt: '2026-10-08T09:00:00.000Z',
      deliveredAt: '2026-10-08T09:00:00.000Z',
    });
  });
  it('a failure carries its code and reason and no receipt dates', () => {
    expect(
      receiptOf({
        message_id: 'w',
        status: { sent: d('2026-07-27T10:00:00Z'), failed: d('2026-07-27T10:00:02Z') },
        error: '(#131049) Message not delivered',
      }),
    ).toMatchObject({ status: 'failed', deliveredAt: null, readAt: null, failureCode: '131049' });
  });
  it('no message id or no readable step: no receipt', () => {
    expect(receiptOf({ status: { sent: d('2026-07-27T10:00:00Z') } })).toBeNull();
    expect(receiptOf({ message_id: 'w', status: {} })).toBeNull();
  });
});

describe('mergeReceipts and classifyDelivery', () => {
  const r = (status: Receipt['status']): Receipt => ({
    wamid: 'w',
    status,
    deliveredAt: null,
    readAt: null,
    failureCode: null,
    failureReason: null,
  });
  it('the furthest step wins; a failure stands only when nothing got further', () => {
    expect(mergeReceipts(r('sent'), r('delivered')).status).toBe('delivered');
    expect(mergeReceipts(r('read'), r('delivered')).status).toBe('read');
    expect(mergeReceipts(r('failed'), r('delivered')).status).toBe('delivered');
    expect(mergeReceipts(r('sent'), r('failed')).status).toBe('sent');
  });
  it('moves only sent rows forward and never touches what the app moved', () => {
    const want = new Map<string, Receipt>([
      ['a', r('delivered')],
      ['b', r('read')],
      ['c', r('sent')],
      ['d', r('delivered')],
      ['e', r('failed')],
    ]);
    const rows = [
      { id: 1, status: 'sent', k: 'a' },
      { id: 2, status: 'sent', k: 'b' },
      { id: 3, status: 'sent', k: 'c' },
      { id: 4, status: 'read', k: 'd' }, // the live app got further
      { id: 5, status: 'sent', k: 'zzz' },
      { id: 6, status: 'sent', k: 'e' },
    ];
    const c = classifyDelivery(rows, want, (x) => (x as (typeof rows)[number]).k);
    expect(c.todo.map((t) => [t.id, t.receipt.status])).toEqual([
      [1, 'delivered'],
      [2, 'read'],
      [6, 'failed'],
    ]);
    expect(c).toMatchObject({ alreadyRight: 1, kept: 1, noReceipt: 1 });
  });
});

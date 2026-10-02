import { describe, expect, it } from 'vitest';
import {
  aggregates,
  outcome,
  shouldAdvance,
} from '../../../src/modules/broadcasts/recipient-status';

describe('shouldAdvance (TW-BCAST-027 rule 4)', () => {
  it('moves forward and stays put', () => {
    expect(shouldAdvance('pending', 'sent')).toBe(true);
    expect(shouldAdvance('sent', 'delivered')).toBe(true);
    expect(shouldAdvance('delivered', 'read')).toBe(true);
    expect(shouldAdvance('sent', 'sent')).toBe(true);
  });

  it('never moves backwards', () => {
    expect(shouldAdvance('delivered', 'sent')).toBe(false);
    expect(shouldAdvance('sent', 'pending')).toBe(false);
  });

  it('a read row ignores a late delivered, sent or failed', () => {
    for (const s of ['delivered', 'sent', 'failed', 'pending'])
      expect(shouldAdvance('read', s)).toBe(false);
  });

  it('a failed row stays failed', () => {
    for (const s of ['sent', 'delivered', 'read', 'pending'])
      expect(shouldAdvance('failed', s)).toBe(false);
  });

  it('any earlier row can fail', () => {
    for (const s of ['pending', 'processing', 'sent', 'delivered'])
      expect(shouldAdvance(s, 'failed')).toBe(true);
  });

  it('ignores a status it does not know', () => {
    expect(shouldAdvance('sent', 'weird')).toBe(false);
  });
});

describe('aggregates (TW-BCAST-027 acceptance)', () => {
  it('{1 sent, 2 delivered, 1 read, 1 failed} is success 4, delivered 3, read 1, fail 1', () => {
    expect(
      aggregates({ pending: 0, processing: 0, sent: 1, delivered: 2, read: 1, failed: 1 }),
    ).toEqual({
      successCount: 4,
      deliveredCount: 3,
      readCount: 1,
      failCount: 1,
    });
  });
});

describe('outcome (TW-BCAST-026)', () => {
  const c = (o: Partial<Record<string, number>>) => ({
    pending: 0,
    processing: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    ...o,
  });
  it('is open while anyone is waiting or being sent', () => {
    expect(outcome(c({ pending: 1, sent: 3 }))).toBeNull();
    expect(outcome(c({ processing: 1, sent: 3 }))).toBeNull();
  });
  it('is open for an empty broadcast', () => {
    expect(outcome(c({}))).toBeNull();
  });
  it('completed when none failed', () => {
    expect(outcome(c({ sent: 2, delivered: 1 }))).toBe('completed');
  });
  it('completed with errors when some failed', () => {
    expect(outcome(c({ sent: 2, failed: 1 }))).toBe('completed_with_errors');
  });
  it('failed when all failed', () => {
    expect(outcome(c({ failed: 3 }))).toBe('failed');
  });
});

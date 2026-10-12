import { describe, expect, it } from 'vitest';
import type { MessageLogEvent } from '@crm/contracts';
import {
  defaultExportRange,
  exportRangeProblem,
  isIgnored,
  isProblem,
  lastProblem,
  logEventKey,
  oldestExportDay,
} from './message-log';

const NOW = new Date('2026-10-11T15:30:00.000Z');

const ev = (over: Partial<MessageLogEvent>): MessageLogEvent => ({
  event: 'queued',
  at: '2026-10-11T15:21:40.000Z',
  source: 'system',
  providerMessageId: null,
  errorCode: null,
  errorMessage: null,
  attempt: null,
  byUserId: null,
  applied: null,
  replayed: null,
  detail: {},
  ...over,
});

describe('which wording a log line gets', () => {
  it('tells our own "accepted" from the provider\'s "sent" receipt, and a failed send from a failed receipt', () => {
    expect(logEventKey(ev({ event: 'sent', source: 'system' }))).toBe('accepted');
    expect(logEventKey(ev({ event: 'sent', source: 'provider' }))).toBe('sentReceipt');
    expect(logEventKey(ev({ event: 'failed', source: 'system' }))).toBe('failedSend');
    expect(logEventKey(ev({ event: 'failed', source: 'provider' }))).toBe('failedReceipt');
  });

  it("names every other event, and a manual retry apart from the queue's own", () => {
    expect(logEventKey(ev({ event: 'queued' }))).toBe('queued');
    expect(logEventKey(ev({ event: 'attempt', attempt: 2 }))).toBe('attempt');
    expect(logEventKey(ev({ event: 'delivered', source: 'provider' }))).toBe('delivered');
    expect(logEventKey(ev({ event: 'read', source: 'provider' }))).toBe('read');
    expect(logEventKey(ev({ event: 'retry', detail: { manual: true } }))).toBe('retryManual');
    expect(logEventKey(ev({ event: 'retry', detail: { attempt: 1 } }))).toBe('retryAuto');
  });

  it('marks failures as problems, a receipt that changed nothing as ignored, and finds the last problem', () => {
    const events = [
      ev({ event: 'failed', errorCode: 'A' }),
      ev({ event: 'sent' }),
      ev({ event: 'failed', errorCode: 'B', applied: false }),
    ];
    expect(isProblem(events[0]!)).toBe(true);
    expect(isProblem(events[1]!)).toBe(false);
    expect(isIgnored(events[2]!)).toBe(true);
    expect(isIgnored(events[0]!)).toBe(false);
    expect(lastProblem(events)?.errorCode).toBe('B');
    expect(lastProblem([ev({ event: 'sent' })])).toBeNull();
  });
});

describe('the export form', () => {
  it('starts on the last 7 days, in UTC', () => {
    expect(defaultExportRange(NOW)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('goes back at most 365 days', () => {
    expect(oldestExportDay(NOW)).toBe('2025-10-11');
  });

  const cases: Array<[string, string, string | null]> = [
    ['2026-10-05', '2026-10-11', null],
    ['2025-10-11', '2026-10-11', null],
    ['2025-10-10', '2026-10-11', 'tooOld'],
    ['2026-10-11', '2026-10-10', 'order'],
    ['2026-10-05', '2026-10-12', 'future'],
    ['', '2026-10-11', 'invalid'],
    ['2026-10-05', 'soon', 'invalid'],
  ];
  it.each(cases)('%s to %s -> %s', (from, to, expected) => {
    expect(exportRangeProblem(from, to, NOW)).toBe(expected);
  });
});

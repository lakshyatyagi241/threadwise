import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  csvFileName,
  csvLine,
  csvRow,
  guardFormula,
  lastEvent,
  localMinute,
  type CsvRecipient,
} from '../../../src/modules/broadcasts/broadcast-csv';
import {
  DEFAULT_RETRY_POLICY,
  isPermanentFailure,
  resolvePolicy,
  retryDelaySeconds,
} from '../../../src/modules/broadcasts/retry-policy';

describe('retry policy (WD-BCAST-039)', () => {
  it('waits base x 2^(n-1) seconds, capped at an hour; a base of 0 is at once', () => {
    expect([1, 2, 3, 4].map((n) => retryDelaySeconds(n, 60))).toEqual([60, 120, 240, 480]);
    expect(retryDelaySeconds(20, 60)).toBe(3600);
    expect(retryDelaySeconds(3, 0)).toBe(0);
  });

  it('defaults to 3 attempts and 60 seconds, and keeps attempts at 1 or more', () => {
    expect(resolvePolicy(null)).toEqual(DEFAULT_RETRY_POLICY);
    expect(resolvePolicy({ attempts: 0, backoffSeconds: -5 })).toEqual({
      attempts: 1,
      backoffSeconds: 0,
    });
    expect(resolvePolicy({ attempts: '5', backoffSeconds: '30' })).toEqual({
      attempts: 5,
      backoffSeconds: 30,
    });
    expect(resolvePolicy({ attempts: 'x' })).toEqual(DEFAULT_RETRY_POLICY);
    // A value that is not there is the default, never zero.
    expect(resolvePolicy({ attempts: null, backoffSeconds: null })).toEqual(DEFAULT_RETRY_POLICY);
    expect(resolvePolicy({ attempts: '', backoffSeconds: undefined })).toEqual(
      DEFAULT_RETRY_POLICY,
    );
  });

  it('does not retry what a retry cannot fix', () => {
    expect(isPermanentFailure('No usable phone number')).toBe(true);
    expect(isPermanentFailure('(#131026) Message undeliverable')).toBe(true);
    expect(isPermanentFailure('timeout')).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });
});

const base: CsvRecipient = {
  name: 'Ana',
  phoneDigits: '919876543210',
  status: 'sent',
  clicked: false,
  queuedAt: new Date('2026-10-02T03:30:00Z'),
  sentAt: new Date('2026-10-02T03:31:00Z'),
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  error: null,
};

describe('csv (WD-BCAST-037)', () => {
  it('has the columns in order', () => {
    expect(csvLine(CSV_HEADER)).toBe(
      'Recipient,Phone,Status,Clicked,Queued,Sent,Delivered,Read,Failed,Last event,Error\n',
    );
  });

  it('writes the row with times in the broadcast zone', () => {
    expect(csvRow(base, 'Asia/Kolkata')).toBe(
      'Ana,919876543210,Sent,No,2026-10-02 09:00,2026-10-02 09:01,,,,Sent,\n',
    );
  });

  it('quotes a cell with a comma, quote or line break', () => {
    expect(csvRow({ ...base, name: 'Rao, A', error: 'said "no"\nthen left' }, 'UTC')).toContain(
      '"Rao, A"',
    );
    expect(csvRow({ ...base, error: 'said "no"' }, 'UTC')).toContain('"said ""no"""');
  });

  it('guards a formula in the name and the error, not in the digits', () => {
    expect(guardFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(guardFormula('+1 call')).toBe("'+1 call");
    expect(guardFormula('Ana')).toBe('Ana');
    expect(csvRow({ ...base, name: '=SUM(A1)', error: '@cmd' }, 'UTC')).toMatch(
      /^'=SUM\(A1\),919876543210,.*,'@cmd\n$/,
    );
  });

  it('last event: a tap beats read, delivered, sent, failed, queued', () => {
    expect(lastEvent({ ...base, clicked: true, readAt: new Date() })).toBe('Button tap');
    expect(lastEvent({ ...base, readAt: new Date(), deliveredAt: new Date() })).toBe('Read');
    expect(lastEvent({ ...base, deliveredAt: new Date() })).toBe('Delivered');
    expect(lastEvent(base)).toBe('Sent');
    expect(lastEvent({ ...base, sentAt: null, failedAt: new Date() })).toBe('Failed');
    expect(lastEvent({ ...base, sentAt: null })).toBe('Queued');
  });

  it('shows Clicked yes and capitalises the status; pending when blank', () => {
    expect(csvRow({ ...base, clicked: true, status: '' }, 'UTC')).toContain(',Pending,Yes,');
  });

  it('formats a minute in a zone and is blank for no time', () => {
    expect(localMinute(new Date('2026-10-02T23:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-03 05:00');
    expect(localMinute(null, 'UTC')).toBe('');
  });

  it('names the file after the broadcast and the moment', () => {
    expect(csvFileName('abc', new Date('2026-10-02T10:05:09Z'))).toBe(
      'broadcast-abc-recipients-20261002-100509.csv',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { META_ERROR_RULES } from '../../../src/infra/providers/whatsapp/meta-errors';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
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
  OUTCOME_UNKNOWN_PREFIX,
  PERMANENT_FAILURE_SQL_REGEX,
  PERMANENT_META_CODES,
  isOutcomeUnknown,
  isPermanentFailure,
  resolvePolicy,
  retryDelaySeconds,
} from '../../../src/modules/broadcasts/retry-policy';

describe('retry policy (TW-BCAST-039)', () => {
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

  it('never resends a recipient whose send may have been accepted (RF-02)', () => {
    expect(isPermanentFailure(`${OUTCOME_UNKNOWN_PREFIX}Meta did not answer in time`)).toBe(true);
    expect(isPermanentFailure('Send was interrupted before it finished')).toBe(true);
    // The SQL used by the sweeper skips exactly the same texts.
    const sql = new RegExp(PERMANENT_FAILURE_SQL_REGEX);
    for (const t of [
      `${OUTCOME_UNKNOWN_PREFIX}timeout`,
      'Send was interrupted before it finished',
      'No usable phone number',
      '(#131026) undeliverable',
    ])
      expect(sql.test(t)).toBe(true);
    expect(sql.test('Meta had a temporary problem. Retrying.')).toBe(false);
  });

  it('matches the reason text Meta errors really have, with or without a subcode and trace id (RF-04)', () => {
    expect(isPermanentFailure('Token expired (#190/463, trace AbC)')).toBe(true);
    expect(isPermanentFailure('Template paused (#132015, trace x1)')).toBe(true);
    expect(isPermanentFailure('Undeliverable (#131026)')).toBe(true);
    expect(isPermanentFailure('Token expired (code 190/463, trace AbC)')).toBe(true);
    expect(isPermanentFailure('Undeliverable (code 131026)')).toBe(true);
    expect(isPermanentFailure('Throughput (code 130429, trace x)')).toBe(false);
    expect(isPermanentFailure('Throughput reached (#130429, trace x)')).toBe(false);
    expect(isPermanentFailure('Engagement (#131049)')).toBe(false); // the wizard retries this one itself
    expect(isPermanentFailure('Server hiccup (#1, trace y)')).toBe(false);
    const sql = new RegExp(PERMANENT_FAILURE_SQL_REGEX);
    expect(sql.test('Token expired (#190/463, trace AbC)')).toBe(true);
    expect(sql.test('Throughput reached (#130429, trace x)')).toBe(false);
  });

  it('every permanent Meta code is one the send table marks not retryable', () => {
    for (const code of PERMANENT_META_CODES) {
      const rule = META_ERROR_RULES.find((r) => r.codes.includes(code));
      expect(rule, `code ${code} has a row`).toBeDefined();
      expect(rule!.retryable, `code ${code} is not retryable`).toBe(false);
    }
  });

  it('reads the unknown-outcome flag off any error that carries it', () => {
    expect(isOutcomeUnknown(Object.assign(new Error('x'), { outcomeMayHaveCommitted: true }))).toBe(
      true,
    );
    expect(isOutcomeUnknown(new Error('x'))).toBe(false);
    expect(isOutcomeUnknown(null)).toBe(false);
  });
});

describe('BroadcastDispatchService.recordSent: an accepted send is never turned into a failure (RF-02)', () => {
  const build = (tx: () => Promise<unknown>) => {
    const svc = Object.create(BroadcastDispatchService.prototype) as Record<string, unknown>;
    const mirror = vi.fn().mockResolvedValue(true);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = { error: vi.fn(), warn: vi.fn() };
    Object.assign(svc, {
      db: { tx: vi.fn(tx) },
      progress: {},
      mirror: { mirror },
      runtime: { sleep },
      logger,
    });
    const call = () =>
      (svc.recordSent as (...a: unknown[]) => Promise<void>).call(svc, 1, 2, 3, 'wamid.X');
    return { call, svc, mirror, sleep, logger };
  };

  it('retries the write, then logs with the provider id and does not throw when the database stays down', async () => {
    const { call, svc, mirror, sleep, logger } = build(() => Promise.reject(new Error('db down')));
    await expect(call()).resolves.toBeUndefined();
    expect((svc.db as { tx: ReturnType<typeof vi.fn> }).tx).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(mirror).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: 'wamid.X' }),
      expect.stringContaining('could not be recorded'),
    );
  });

  it('a failing inbox mirror does not undo the recorded send', async () => {
    const { call, svc, mirror, logger } = build(() => Promise.resolve());
    mirror.mockRejectedValue(new Error('mirror down'));
    await expect(call()).resolves.toBeUndefined();
    expect((svc.db as { tx: ReturnType<typeof vi.fn> }).tx).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers when the database comes back on the second try', async () => {
    let n = 0;
    const { call, svc, logger } = build(() =>
      ++n === 1 ? Promise.reject(new Error('blip')) : Promise.resolve(),
    );
    await call();
    expect((svc.db as { tx: ReturnType<typeof vi.fn> }).tx).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
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

describe('csv (TW-BCAST-037)', () => {
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

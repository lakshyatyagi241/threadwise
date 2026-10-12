import { describe, expect, it } from 'vitest';
import {
  MESSAGE_LOG_HOT_DAYS,
  MESSAGE_LOG_RETENTION_DAYS,
  createMessageLogExportSchema,
} from '@crm/contracts';
import { archivedEventsOf } from '../../../src/modules/chat-conversations/message-log.service';
import {
  addDays,
  csvCell,
  csvLine,
  csvSafe,
  daysBetween,
  exportRangeProblem,
  hotCutoff,
  retentionCutoff,
  retryUserId,
  toLogEvent,
} from '../../../src/modules/chat-conversations/message-log-rules';
import { gzipSync } from 'node:zlib';

const NOW = new Date('2026-10-11T15:30:00.000Z');

describe('the windows of the message log', () => {
  it('archives whole UTC days: the live cut is the start of the day 90 days back', () => {
    expect(hotCutoff(NOW).toISOString()).toBe(
      `${addDays('2026-10-11', -MESSAGE_LOG_HOT_DAYS)}T00:00:00.000Z`,
    );
    // The same cut at any time of that day.
    expect(hotCutoff(new Date('2026-10-11T00:00:00.000Z')).getTime()).toBe(
      hotCutoff(NOW).getTime(),
    );
    expect(hotCutoff(new Date('2026-10-11T23:59:59.999Z')).getTime()).toBe(
      hotCutoff(NOW).getTime(),
    );
  });

  it('keeps a year: the retention cut is the start of the day 365 days back', () => {
    expect(retentionCutoff(NOW).toISOString()).toBe('2025-10-11T00:00:00.000Z');
    expect(MESSAGE_LOG_RETENTION_DAYS).toBe(365);
  });

  it('lists the days of a range, both ends included', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(daysBetween('2026-10-11', '2026-10-11')).toEqual(['2026-10-11']);
  });
});

describe('what an export may ask for', () => {
  const cases: Array<[string, string, string | null]> = [
    ['2026-10-01', '2026-10-11', null],
    ['2026-10-11', '2026-10-11', null],
    ['2025-10-11', '2026-10-11', null], // exactly a year back is the oldest allowed day
    ['2025-10-10', '2026-10-11', 'too_old'],
    ['2026-10-11', '2026-10-10', 'order'],
    ['2026-10-01', '2026-10-12', 'future'],
  ];
  it.each(cases)('%s to %s -> %s', (from, to, problem) => {
    expect(exportRangeProblem(from, to, NOW)).toBe(problem);
  });

  it('only accepts real dates and a known status, nothing else', () => {
    expect(
      createMessageLogExportSchema.safeParse({ from: '2026-10-01', to: '2026-10-11' }).success,
    ).toBe(true);
    expect(
      createMessageLogExportSchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-11',
        messageStatus: 'failed',
      }).success,
    ).toBe(true);
    expect(
      createMessageLogExportSchema.safeParse({ from: '1 Oct', to: '2026-10-11' }).success,
    ).toBe(false);
    expect(
      createMessageLogExportSchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-11',
        messageStatus: 'nope',
      }).success,
    ).toBe(false);
    expect(
      createMessageLogExportSchema.safeParse({ from: '2026-10-01', to: '2026-10-11', orgId: 3 })
        .success,
    ).toBe(false);
  });
});

describe('a stored event as a log line', () => {
  const at = new Date('2026-10-11T15:21:42.000Z');

  it('reads a provider receipt (errorCode / errorMessage) and the pipeline (code / reason) the same way', () => {
    const fromReceipt = toLogEvent(
      {
        event: 'failed',
        at,
        detail: {
          applied: true,
          errorCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
          errorMessage: 'not delivered (#131049)',
          providerAt: '2026-10-11T15:21:42.000Z',
        },
      },
      null,
    );
    expect(fromReceipt).toMatchObject({
      source: 'provider',
      errorCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
      errorMessage: 'not delivered (#131049)',
      applied: true,
    });
    const fromPipeline = toLogEvent(
      {
        event: 'failed',
        at,
        detail: { code: 'SERVICE_WINDOW_CLOSED', reason: 'closed', attempt: 1 },
      },
      null,
    );
    expect(fromPipeline).toMatchObject({
      source: 'system',
      errorCode: 'SERVICE_WINDOW_CLOSED',
      errorMessage: 'closed',
      attempt: 1,
      applied: null,
    });
  });

  it('keeps what a send recorded: the provider id and whether the answer was replayed', () => {
    expect(
      toLogEvent(
        { event: 'sent', at, detail: { providerMessageId: 'wamid.X', replayed: true } },
        null,
      ),
    ).toMatchObject({ providerMessageId: 'wamid.X', replayed: true });
  });

  it('names the agent only for a manual retry', () => {
    const manual = { event: 'retry', at, detail: { manual: true, by: 63 } };
    expect(retryUserId(manual)).toBe(63);
    expect(retryUserId({ event: 'retry', at, detail: { attempt: 2, code: 'X' } })).toBeNull();
    expect(retryUserId({ event: 'failed', at, detail: { manual: true, by: 63 } })).toBeNull();
    expect(toLogEvent(manual, 'uuid-63').byUserId).toBe('uuid-63');
  });

  it('survives an event with no detail at all', () => {
    expect(toLogEvent({ event: 'queued', at, detail: undefined as never }, null)).toMatchObject({
      event: 'queued',
      providerMessageId: null,
      errorCode: null,
      detail: {},
    });
  });
});

describe('the CSV', () => {
  it('quotes what needs quotes and neutralises what a spreadsheet would run', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvSafe('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(csvSafe('+91 99999')).toBe(`'+91 99999`);
    expect(csvSafe('Hello')).toBe('Hello');
  });

  it('one line per event, blank where the message row is gone', () => {
    const e = toLogEvent(
      {
        event: 'failed',
        at: new Date('2026-10-11T15:21:42.000Z'),
        detail: { errorCode: 'X', errorMessage: '=bad', applied: false },
      },
      null,
    );
    expect(csvLine(e, undefined, null)).toBe(
      "2026-10-11T15:21:42.000Z,,,,,,,failed,,,X,'=bad,no,,",
    );
    const line = csvLine(
      e,
      {
        uuid: 'm1',
        recipient: '919900000001',
        channel: 'whatsapp_cloud',
        kind: 'template',
        template: 'promo',
        status: 'failed',
      },
      'Asha',
    );
    expect(
      line.startsWith(
        '2026-10-11T15:21:42.000Z,m1,919900000001,whatsapp_cloud,template,promo,failed,failed',
      ),
    ).toBe(true);
    expect(line.endsWith(',Asha')).toBe(true);
  });
});

describe('reading one message out of an archive day', () => {
  const lines = (...rows: Array<Record<string, unknown>>) =>
    gzipSync(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const base = { detail: {}, at: '2026-06-01T10:00:00.000Z' };

  it('keeps only the events of that message (id and creation time), across gzip members', () => {
    const mine = { id: 7, createdAtText: '2026-06-01 09:59:00.123456+00' };
    const day = Buffer.concat([
      lines(
        { ...base, id: 1, messageId: 7, messageCreatedAt: mine.createdAtText, event: 'queued' },
        { ...base, id: 2, messageId: 8, messageCreatedAt: mine.createdAtText, event: 'queued' },
      ),
      lines(
        {
          ...base,
          id: 3,
          messageId: 7,
          messageCreatedAt: '2026-06-02 09:59:00.123456+00',
          event: 'queued',
        },
        { ...base, id: 4, messageId: 7, messageCreatedAt: mine.createdAtText, event: 'sent' },
      ),
    ]);
    const got = archivedEventsOf([day], mine);
    expect(got.map((e) => e.event)).toEqual(['queued', 'sent']);
  });
});

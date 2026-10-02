import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, CSV_COLUMNS, csvCell, csvFilename, eventsToCsv } from './events-csv';
import type { SecurityEventRow } from './event-view';

const row = (over: Partial<SecurityEventRow> = {}): SecurityEventRow => ({
  id: 'evt-1',
  at: '2026-10-01T10:00:00.000Z',
  event: 'auth.failed',
  status: 'failure',
  actorType: 'user',
  actorId: '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b',
  actorName: 'Ann Lee',
  actorEmail: 'ann@example.com',
  orgId: null,
  orgSlug: null,
  orgName: null,
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  requestId: 'req-1',
  payload: {},
  ...over,
});

describe('csvCell', () => {
  it('leaves plain text alone and empties null and undefined', () => {
    expect(csvCell('auth.failed')).toBe('auth.failed');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a cell with a comma, quote or line break and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it.each(['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', '\tcmd', '\rcmd'])(
    'neutralises the spreadsheet formula %j',
    (text) => {
      const cell = csvCell(text);
      expect(cell.startsWith("'") || cell.startsWith(`"'`)).toBe(true);
      expect(cell.replace(/^"/, '')[0]).toBe("'");
    },
  );

  it('neutralises before quoting, so a formula with a comma stays text', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('writes an object as JSON', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('does not treat a formula character in the middle as a formula', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('x-ray')).toBe('x-ray');
  });
});

describe('eventsToCsv', () => {
  it('starts with a byte-order mark and the header, one CRLF line per row', () => {
    const csv = eventsToCsv([row(), row({ id: 'evt-2', event: 'auth.lockout' })]);
    expect(BYTE_ORDER_MARK.charCodeAt(0)).toBe(0xfeff);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(BYTE_ORDER_MARK + CSV_COLUMNS.join(','))).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
  });

  it('writes the columns in order and empties what the event does not have', () => {
    const [, line] = eventsToCsv([row()]).slice(1).split('\r\n');
    expect(line).toBe(
      [
        '2026-10-01T10:00:00.000Z',
        'failure',
        'auth.failed',
        'user',
        '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b',
        'Ann Lee',
        'ann@example.com',
        '',
        '',
        '',
        '203.0.113.9',
        'Mozilla/5.0 (X11; Linux x86_64)',
        'req-1',
        '',
      ].join(','),
    );
  });

  it('puts the payload in as one JSON cell', () => {
    const csv = eventsToCsv([row({ payload: { identifier: 'ann@example.com', n: 2 } })]);
    expect(csv).toContain('"{""identifier"":""ann@example.com"",""n"":2}"');
  });

  it('neutralises a name, email or user agent a user controls', () => {
    const csv = eventsToCsv([
      row({ actorName: '=cmd|calc', actorEmail: '+evil@x.io', userAgent: '@SUM(1)' }),
    ]);
    expect(csv).toContain(",'=cmd|calc,");
    expect(csv).toContain(",'+evil@x.io,");
    expect(csv).toContain(",'@SUM(1),");
  });

  it('is just the header for no rows', () => {
    expect(eventsToCsv([])).toBe(`${BYTE_ORDER_MARK}${CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('csvFilename', () => {
  it('names the file by the local date', () => {
    expect(csvFilename(new Date(2026, 9, 1, 12, 0, 0))).toBe('security-events-2026-10-01.csv');
    expect(csvFilename(new Date(2026, 0, 5))).toBe('security-events-2026-01-05.csv');
  });
});

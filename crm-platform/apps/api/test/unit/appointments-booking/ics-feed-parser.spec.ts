import { describe, expect, it } from 'vitest';
import {
  IcsFormatError,
  parseIcsBusy,
  WINDOWS_ZONES,
  zoneOf,
  type IcsParseOptions,
} from '../../../src/modules/appointments-booking/ics-feed-parser';

/** Reading a calendar feed into busy time (BL-035). */
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString();

const opts = (over: Partial<IcsParseOptions> = {}): IcsParseOptions => ({
  defaultZone: 'UTC',
  fromMs: at('2026-10-01T00:00:00Z'),
  toMs: at('2027-06-30T00:00:00Z'),
  blockAllDay: true,
  ...over,
});

const cal = (...events: string[][]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const starts = (text: string, o = opts()) => parseIcsBusy(text, o).busy.map((b) => iso(b.startMs));
const spans = (text: string, o = opts()) =>
  parseIcsBusy(text, o).busy.map((b) => `${iso(b.startMs)}/${iso(b.endMs)}`);

describe('what is a calendar', () => {
  it('refuses text that is not an iCalendar, so an HTML page is not read as "no events"', () => {
    expect(() => parseIcsBusy('<html><body>Sign in</body></html>', opts())).toThrow(IcsFormatError);
    expect(() => parseIcsBusy('', opts())).toThrow(IcsFormatError);
  });

  it('an empty calendar is valid and has no busy time', () => {
    const r = parseIcsBusy('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', opts());
    expect(r).toMatchObject({ busy: [], events: 0 });
  });

  it('reads the feed name, tolerates a byte order mark, LF line endings and folded lines', () => {
    const text =
      '﻿BEGIN:VCALENDAR\nX-WR-CALNAME:Work\n BOOK\nBEGIN:VEVENT\nUID:a\nDTSTART:20261005T090000Z\nDTEND:20261005T100000Z\nSUMMARY:Long\n  title\nEND:VEVENT\nEND:VCALENDAR\n';
    const r = parseIcsBusy(text, opts());
    expect(r.calendarName).toBe('WorkBOOK');
    expect(spans(text)).toEqual(['2026-10-05T09:00:00.000Z/2026-10-05T10:00:00.000Z']);
  });

  it('a nested alarm does not change the event', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'END:VALARM',
    ]);
    expect(spans(text)).toEqual(['2026-10-05T09:00:00.000Z/2026-10-05T10:00:00.000Z']);
  });
});

describe('single events', () => {
  it('uses DTEND, else DURATION, and a point in time blocks nothing', () => {
    const text = cal(
      ['UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T093000Z'],
      ['UID:b', 'DTSTART:20261006T090000Z', 'DURATION:PT1H30M'],
      ['UID:c', 'DTSTART:20261007T090000Z'],
    );
    expect(spans(text)).toEqual([
      '2026-10-05T09:00:00.000Z/2026-10-05T09:30:00.000Z',
      '2026-10-06T09:00:00.000Z/2026-10-06T10:30:00.000Z',
    ]);
  });

  it('skips cancelled and transparent (free) events, keeps tentative ones', () => {
    const text = cal(
      ['UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'STATUS:CANCELLED'],
      ['UID:b', 'DTSTART:20261006T090000Z', 'DTEND:20261006T100000Z', 'TRANSP:TRANSPARENT'],
      ['UID:c', 'DTSTART:20261007T090000Z', 'DTEND:20261007T100000Z', 'STATUS:TENTATIVE'],
    );
    expect(starts(text)).toEqual(['2026-10-07T09:00:00.000Z']);
  });

  it('leaves out what is outside the window', () => {
    const text = cal(
      ['UID:a', 'DTSTART:20260901T090000Z', 'DTEND:20260901T100000Z'],
      ['UID:b', 'DTSTART:20280101T090000Z', 'DTEND:20280101T100000Z'],
      ['UID:c', 'DTSTART:20260930T230000Z', 'DTEND:20261001T010000Z'],
    );
    // The third one overlaps the start of the window and is kept.
    expect(starts(text)).toEqual(['2026-09-30T23:00:00.000Z']);
  });

  it('merges overlapping and touching events', () => {
    const text = cal(
      ['UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z'],
      ['UID:b', 'DTSTART:20261005T093000Z', 'DTEND:20261005T110000Z'],
      ['UID:c', 'DTSTART:20261005T110000Z', 'DTEND:20261005T113000Z'],
    );
    expect(spans(text)).toEqual(['2026-10-05T09:00:00.000Z/2026-10-05T11:30:00.000Z']);
  });
});

describe('time zones', () => {
  it('a TZID is read in that zone', () => {
    const text = cal([
      'UID:a',
      'DTSTART;TZID=Asia/Kolkata:20261005T150000',
      'DTEND;TZID=Asia/Kolkata:20261005T160000',
    ]);
    expect(spans(text)).toEqual(['2026-10-05T09:30:00.000Z/2026-10-05T10:30:00.000Z']);
  });

  it('a Windows zone name, as Outlook writes it, is understood', () => {
    const text = cal([
      'UID:a',
      'DTSTART;TZID=Eastern Standard Time:20261105T090000',
      'DTEND;TZID=Eastern Standard Time:20261105T100000',
    ]);
    // 9:00 in New York on 5 November 2026 is EST (UTC-5).
    expect(starts(text)).toEqual(['2026-11-05T14:00:00.000Z']);
  });

  it('every mapped Windows name resolves to a zone this runtime knows', () => {
    for (const name of Object.keys(WINDOWS_ZONES)) expect(zoneOf(name), name).not.toBeNull();
  });

  it("a floating time is the workspace's, or the feed's own zone when it says one", () => {
    const text = cal(['UID:a', 'DTSTART:20261005T090000', 'DTEND:20261005T100000']);
    expect(starts(text, opts({ defaultZone: 'Asia/Tokyo' }))).toEqual(['2026-10-05T00:00:00.000Z']);
    const withZone = text.replace('VERSION:2.0', 'VERSION:2.0\r\nX-WR-TIMEZONE:Europe/Paris');
    expect(starts(withZone, opts({ defaultZone: 'Asia/Tokyo' }))).toEqual([
      '2026-10-05T07:00:00.000Z',
    ]);
  });

  it('an unknown zone is read in the default zone and counted, not dropped', () => {
    const text = cal([
      'UID:a',
      'DTSTART;TZID=Mars/Olympus:20261005T090000',
      'DTEND;TZID=Mars/Olympus:20261005T100000',
    ]);
    const r = parseIcsBusy(text, opts({ defaultZone: 'UTC' }));
    expect(r.busy).toHaveLength(1);
    expect(r.warnings.unknownZone).toBeGreaterThan(0);
  });

  it('a vendor prefix on the zone name is ignored', () => {
    expect(zoneOf('/mozilla.org/20050126_1/Europe/Paris')).toBe('Europe/Paris');
    expect(zoneOf('"Europe/Paris"')).toBe('Europe/Paris');
    expect(zoneOf('')).toBeNull();
    expect(zoneOf('Nowhere/Land')).toBeNull();
  });
});

describe('all-day events', () => {
  const text = cal(
    ['UID:a', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106'],
    ['UID:b', 'DTSTART;VALUE=DATE:20261110'],
  );

  it('block their whole local day, a one-day event with no end included', () => {
    expect(spans(text, opts({ defaultZone: 'Asia/Kolkata' }))).toEqual([
      '2026-11-04T18:30:00.000Z/2026-11-05T18:30:00.000Z',
      '2026-11-09T18:30:00.000Z/2026-11-10T18:30:00.000Z',
    ]);
  });

  it('are left out when the feed is set to ignore them, and when they are marked free', () => {
    expect(starts(text, opts({ blockAllDay: false }))).toEqual([]);
    const free = cal(['UID:a', 'DTSTART;VALUE=DATE:20261105', 'TRANSP:TRANSPARENT']);
    expect(starts(free)).toEqual([]);
  });
});

describe('recurring events', () => {
  it('a daily rule with COUNT, and DTSTART as its first instance', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
    ]);
    expect(starts(text)).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-06T09:00:00.000Z',
      '2026-10-07T09:00:00.000Z',
    ]);
  });

  it('COUNT=1 is DTSTART alone', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=WEEKLY;COUNT=1',
    ]);
    expect(starts(text)).toEqual(['2026-10-05T09:00:00.000Z']);
  });

  it('weekly on chosen days, every other week, until a date', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z', // a Monday
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261031T000000Z',
    ]);
    expect(starts(text).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-19',
      '2026-10-21',
    ]);
  });

  it('DTSTART counts as the first instance even when the rule would not pick that weekday', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261006T090000Z',
      'DTEND:20261006T100000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
    ]); // a Tuesday
    expect(starts(text).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-06',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('monthly on the second Tuesday and on the last day of the month', () => {
    const second = cal([
      'UID:a',
      'DTSTART:20261013T090000Z',
      'DTEND:20261013T100000Z',
      'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3',
    ]);
    expect(starts(second).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
    ]);
    const last = cal([
      'UID:b',
      'DTSTART:20261031T090000Z',
      'DTEND:20261031T100000Z',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3',
    ]);
    expect(starts(last).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('monthly on the 31st skips the months that have no 31st', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261031T090000Z',
      'DTEND:20261031T100000Z',
      'RRULE:FREQ=MONTHLY;COUNT=3',
    ]);
    expect(starts(text).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-31',
      '2026-12-31',
      '2027-01-31',
    ]);
  });

  it('the last weekday of the month through BYSETPOS', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261030T090000Z',
      'DTEND:20261030T100000Z',
      'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3',
    ]);
    expect(starts(text).map((s) => s.slice(0, 10))).toEqual([
      '2026-10-30',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('yearly keeps its month and day', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20260315T090000Z',
      'DTEND:20260315T100000Z',
      'RRULE:FREQ=YEARLY;COUNT=3',
    ]);
    expect(
      starts(
        text,
        opts({ fromMs: at('2026-01-01T00:00:00Z'), toMs: at('2030-01-01T00:00:00Z') }),
      ).map((s) => s.slice(0, 10)),
    ).toEqual(['2026-03-15', '2027-03-15', '2028-03-15']);
  });

  it('keeps 9:00 on the wall clock across a daylight-saving change', () => {
    const text = cal([
      'UID:a',
      'DTSTART;TZID=America/New_York:20261031T090000', // the clocks go back overnight, early on 1 November
      'DTEND;TZID=America/New_York:20261031T100000',
      'RRULE:FREQ=DAILY;COUNT=3',
    ]);
    expect(starts(text)).toEqual([
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  it('EXDATE removes an occurrence, and a RECURRENCE-ID override replaces one', () => {
    const text = cal(
      [
        'UID:a',
        'DTSTART:20261005T090000Z',
        'DTEND:20261005T100000Z',
        'RRULE:FREQ=DAILY;COUNT=4',
        'EXDATE:20261006T090000Z',
      ],
      [
        'UID:a',
        'RECURRENCE-ID:20261007T090000Z',
        'DTSTART:20261007T140000Z',
        'DTEND:20261007T150000Z',
      ],
    );
    expect(starts(text)).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-07T14:00:00.000Z',
      '2026-10-08T09:00:00.000Z',
    ]);
  });

  it('a cancelled override frees that occurrence', () => {
    const text = cal(
      ['UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'RRULE:FREQ=DAILY;COUNT=3'],
      [
        'UID:a',
        'RECURRENCE-ID:20261006T090000Z',
        'DTSTART:20261006T090000Z',
        'DTEND:20261006T100000Z',
        'STATUS:CANCELLED',
      ],
    );
    expect(starts(text)).toEqual(['2026-10-05T09:00:00.000Z', '2026-10-07T09:00:00.000Z']);
  });

  it('RDATE adds instances', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=DAILY;COUNT=1',
      'RDATE:20261020T090000Z,20261021T090000Z',
    ]);
    expect(starts(text)).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
      '2026-10-21T09:00:00.000Z',
    ]);
  });

  it('a rule that began years ago is expanded, and only the window is kept', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20200106T090000Z',
      'DTEND:20200106T100000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
    ]);
    const r = parseIcsBusy(
      text,
      opts({ fromMs: at('2026-10-05T00:00:00Z'), toMs: at('2026-10-20T00:00:00Z') }),
    );
    expect(r.busy.map((b) => iso(b.startMs).slice(0, 10))).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('a rule it does not support is read as its first occurrence, and counted', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=HOURLY;COUNT=5',
    ]);
    const r = parseIcsBusy(text, opts());
    expect(r.busy).toHaveLength(1);
    expect(r.warnings.unsupportedRule).toBe(1);
    const odd = cal([
      'UID:b',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=YEARLY;BYWEEKNO=20',
    ]);
    expect(parseIcsBusy(odd, opts()).warnings.unsupportedRule).toBe(1);
  });
});

describe('limits', () => {
  it('stops an endless rule at the cap and says the result is incomplete', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T091000Z',
      'RRULE:FREQ=DAILY',
    ]);
    const r = parseIcsBusy(
      text,
      opts({ maxOccurrencesPerEvent: 10, toMs: at('2036-01-01T00:00:00Z') }),
    );
    expect(r.busy).toHaveLength(10);
    expect(r.warnings.truncated).toBe(true);
  });

  it('caps the intervals kept and says so', () => {
    const events = Array.from({ length: 20 }, (_, i) => [
      `UID:e${i}`,
      `DTSTART:202610${String(i + 1).padStart(2, '0')}T090000Z`,
      `DTEND:202610${String(i + 1).padStart(2, '0')}T100000Z`,
    ]);
    const r = parseIcsBusy(cal(...events), opts({ maxIntervals: 5 }));
    expect(r.busy).toHaveLength(5);
    expect(r.warnings.truncated).toBe(true);
  });

  it('a hostile rule cannot hang the reader', () => {
    const text = cal([
      'UID:a',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
    ]);
    const started = Date.now();
    parseIcsBusy(text, opts({ toMs: at('2100-01-01T00:00:00Z') }));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine, googleCalendarUrl, icsEscape, icsFileName, icsTime } from './ics';

const NOW = new Date('2026-10-02T08:00:00Z');

describe('ics', () => {
  it('writes UTC times', () => {
    expect(icsTime('2026-10-05T09:30:00Z')).toBe('20261005T093000Z');
    expect(icsTime('2026-10-05T15:00:00+05:30')).toBe('20261005T093000Z');
  });

  it('escapes the characters a text value must escape', () => {
    expect(icsEscape('Room 1, floor 2; "main"\\ side\nsecond line')).toBe(
      'Room 1\\, floor 2\\; "main"\\\\ side\\nsecond line',
    );
  });

  it('folds long lines at 75 octets and never splits a character', () => {
    const long = `DESCRIPTION:${'a'.repeat(200)}`;
    const folded = foldLine(long);
    const lines = folded.split('\r\n');
    expect(lines[0]!.length).toBe(75);
    expect(lines.slice(1).every((l) => l.startsWith(' ') && l.length <= 75)).toBe(true);
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);

    const arabic = `SUMMARY:${'موعد '.repeat(40)}`;
    const parts = foldLine(arabic).split('\r\n');
    const enc = new TextEncoder();
    expect(parts.every((l) => enc.encode(l).length <= 75)).toBe(true);
    expect(parts.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(arabic);
  });

  it('builds a complete calendar with CRLF endings', () => {
    const text = buildIcs({
      uid: 'appt-1@example',
      title: 'Demo, 30 min',
      startsAt: '2026-10-05T09:30:00Z',
      endsAt: '2026-10-05T10:00:00Z',
      location: '12 MG Road',
      description: 'Manage: https://x.test/b/manage/abc',
      url: 'https://x.test/b/manage/abc',
      now: NOW,
    });
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CRM//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:appt-1@example',
      'DTSTAMP:20261002T080000Z',
      'DTSTART:20261005T093000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Demo\\, 30 min',
      'STATUS:CONFIRMED',
      'LOCATION:12 MG Road',
      'DESCRIPTION:Manage: https://x.test/b/manage/abc',
      'URL:https://x.test/b/manage/abc',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('writes a cancellation', () => {
    const text = buildIcs({
      uid: 'u',
      title: 't',
      startsAt: '2026-10-05T09:00:00Z',
      endsAt: '2026-10-05T10:00:00Z',
      status: 'CANCELLED',
      now: NOW,
    });
    expect(text).toContain('METHOD:CANCEL');
    expect(text).toContain('STATUS:CANCELLED');
    expect(text).not.toContain('LOCATION');
  });

  it('makes a safe file name', () => {
    expect(icsFileName('30-min Demo / Sales')).toBe('30-min-Demo-Sales.ics');
    expect(icsFileName('???')).toBe('booking.ics');
    expect(icsFileName('Café')).toBe('Cafe.ics');
  });

  it('builds a Google Calendar link', () => {
    const url = googleCalendarUrl({
      title: 'Demo',
      startsAt: '2026-10-05T09:30:00Z',
      endsAt: '2026-10-05T10:00:00Z',
      location: 'Office',
    });
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    expect(url).toContain('dates=20261005T093000Z%2F20261005T100000Z');
    expect(url).toContain('location=Office');
  });
});

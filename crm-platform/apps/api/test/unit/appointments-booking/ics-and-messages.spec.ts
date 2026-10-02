import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  foldLine,
  icsDateTime,
  icsEscape,
} from '../../../src/modules/appointments-booking/ics';
import {
  DEFAULT_TEXTS,
  messageBody,
  renderTemplate,
  variablesFor,
  type MessageFacts,
} from '../../../src/modules/appointments-booking/message-render';

const event = {
  uid: '1f0e7c1e@appointments',
  title: 'Demo, call; with "Ana"',
  description: 'Line one\nLine two',
  location: 'https://meet.example/abc',
  startsAt: new Date('2026-10-05T03:30:00Z'),
  endsAt: new Date('2026-10-05T04:00:00Z'),
  status: 'confirmed' as const,
  sequence: 3,
  stampedAt: new Date('2026-10-02T10:00:00Z'),
};

describe('ICS (EXT-APPT-06)', () => {
  it('writes one UTC VEVENT with CRLF line endings and a final CRLF', () => {
    const text = buildIcs(event);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n').filter(Boolean)[0]).toBe('BEGIN:VCALENDAR');
    expect(text).toContain('\r\nDTSTART:20261005T033000Z\r\n');
    expect(text).toContain('\r\nDTEND:20261005T040000Z\r\n');
    expect(text).toContain('\r\nDTSTAMP:20261002T100000Z\r\n');
    expect(text).toContain('\r\nUID:1f0e7c1e@appointments\r\n');
    expect(text).toContain('\r\nSEQUENCE:3\r\n');
    expect(text).toContain('\r\nSTATUS:CONFIRMED\r\n');
    expect(text).toContain('\r\nMETHOD:PUBLISH\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it('escapes backslash, semicolon, comma and newlines in text values', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const text = buildIcs(event);
    expect(text).toContain('SUMMARY:Demo\\, call\\; with "Ana"');
    expect(text).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds long lines at 75 octets without splitting a multi-byte character', () => {
    const long = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(long);
    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    // Unfolding gives the original back.
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(foldLine('short')).toBe('short');
  });

  it('a cancelled or declined booking is a cancellation of the same UID', () => {
    for (const status of ['cancelled', 'declined'] as const) {
      const text = buildIcs({ ...event, status });
      expect(text).toContain('STATUS:CANCELLED');
      expect(text).toContain('METHOD:CANCEL');
    }
    expect(buildIcs({ ...event, status: 'pending' })).toContain('STATUS:TENTATIVE');
  });

  it('cannot be made to inject a property through a title or an organizer name', () => {
    const text = buildIcs({
      ...event,
      title: 'x\r\nATTENDEE:mailto:evil@example.com',
      organizer: { name: 'A\r\nB: c', email: 'a@b.co\r\nX:y' },
    });
    expect(text.split('\r\n').some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(icsDateTime(new Date('2026-01-02T03:04:05Z'))).toBe('20260102T030405Z');
  });
});

describe('booking messages (WD-APPT-013, D-14)', () => {
  const facts: MessageFacts = {
    typeName: 'Haircut',
    title: 'Haircut — Ana',
    inviteeName: 'Ana',
    startsAtMs: Date.parse('2026-10-05T03:30:00Z'),
    timezone: 'Asia/Kolkata',
    location: '12 MG Road',
    manageUrl: 'https://app.test/b/manage/TOKEN',
  };

  it('fills {{type}} and {{slot}} the WaDesk way, and the other variables', () => {
    const v = variablesFor(facts);
    expect(v.slot).toBe('Mon 5 Oct · 9:00 AM');
    expect(renderTemplate('See you {{slot}} for {{type}}', v)).toBe(
      'See you Mon 5 Oct · 9:00 AM for Haircut',
    );
    expect(renderTemplate('Hi {{ name }}, {{date}} at {{time}} in {{location}}', v)).toBe(
      'Hi Ana, Mon 5 Oct 2026 at 9:00 AM in 12 MG Road',
    );
  });

  it('accepts the legacy {title} {time} {date} spelling and leaves an unknown variable visible', () => {
    const v = variablesFor(facts);
    expect(renderTemplate('Your appointment "{title}" on {time}', v)).toBe(
      'Your appointment "Haircut — Ana" on 9:00 AM',
    );
    expect(renderTemplate('Hello {{nmae}}', v)).toBe('Hello {{nmae}}');
  });

  it("uses the type's plain body for the event, else the default text", () => {
    expect(messageBody('reminder', 'See you {{slot}}', facts)).toBe('See you Mon 5 Oct · 9:00 AM');
    expect(messageBody('reminder', null, facts)).toBe(
      'Reminder: you have Haircut coming up on Mon 5 Oct · 9:00 AM. See you then!',
    );
    expect(messageBody('cancellation', '   ', facts)).toContain('has been cancelled');
    expect(Object.keys(DEFAULT_TEXTS).sort()).toEqual([
      'cancellation',
      'confirmation',
      'reminder',
      'reschedule',
    ]);
  });

  it('a confirmation or reschedule always carries the manage link; a reminder does not', () => {
    expect(messageBody('confirmation', 'Booked {{slot}}', facts)).toBe(
      'Booked Mon 5 Oct · 9:00 AM\n\nReschedule or cancel: https://app.test/b/manage/TOKEN',
    );
    expect(messageBody('confirmation', 'Booked. Manage: {{manage_link}}', facts)).toBe(
      'Booked. Manage: https://app.test/b/manage/TOKEN',
    );
    expect(messageBody('confirmation', null, facts)).toContain(
      'Reschedule or cancel: https://app.test/b/manage/TOKEN',
    );
    expect(messageBody('reminder', 'Soon', facts)).toBe('Soon');
    expect(messageBody('confirmation', 'Booked', { ...facts, manageUrl: null })).toBe('Booked');
  });
});

import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  ageParts,
  avatarColor,
  dueState,
  formatDateTime,
  formatDay,
  initials,
  monthLabel,
  toDateInput,
} from './format';

const now = new Date(2026, 9, 15, 10, 0, 0);

describe('format helpers', () => {
  it('makes initials', () => {
    expect(initials('Ana Lopez')).toBe('AL');
    expect(initials('  ana  ')).toBe('A');
    expect(initials('Ana Maria Lopez')).toBe('AL');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });

  it('gives a name the same colour every time', () => {
    expect(avatarColor('Ana')).toBe(avatarColor('Ana'));
    expect(avatarColor('Ana')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('judges due dates by calendar day', () => {
    expect(dueState(null, now)).toBeNull();
    expect(dueState('not a date', now)).toBeNull();
    expect(dueState(new Date(2026, 9, 14, 23, 0).toISOString(), now)).toBe('overdue');
    expect(dueState(new Date(2026, 9, 15, 23, 0).toISOString(), now)).toBe('today');
    expect(dueState(new Date(2026, 9, 15, 0, 0).toISOString(), now)).toBe('today');
    expect(dueState(new Date(2026, 9, 16, 0, 0).toISOString(), now)).toBe('upcoming');
    // a bare date is a calendar day, whatever the viewer's zone
    expect(dueState('2026-10-14', now)).toBe('overdue');
    expect(dueState('2026-10-15', now)).toBe('today');
    expect(dueState('2026-10-16', now)).toBe('upcoming');
  });

  it('shortens ages', () => {
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    expect(ageInDays(ago(3), now)).toBe(3);
    expect(ageParts(ago(0), now).unit).toBe('today');
    expect(ageParts(ago(3), now)).toEqual({ unit: 'd', n: 3 });
    expect(ageParts(ago(21), now)).toEqual({ unit: 'w', n: 3 });
    expect(ageParts(ago(120), now)).toEqual({ unit: 'mo', n: 4 });
    expect(ageParts(ago(800), now)).toEqual({ unit: 'y', n: 2 });
    // a clock a little ahead of the server never shows a negative age
    expect(ageInDays(new Date(now.getTime() + 5000).toISOString(), now)).toBe(0);
  });

  it('formats days without a time-zone shift', () => {
    expect(formatDay('2026-03-05', 'en')).toBe('Mar 5, 2026');
    expect(formatDay(null, 'en')).toBe('');
    expect(toDateInput(new Date(2026, 0, 9))).toBe('2026-01-09');
  });

  it('labels months, adding the year only when it differs', () => {
    expect(monthLabel('2026-05', 'en', now)).toBe('May');
    expect(monthLabel('2025-12', 'en', now)).toContain('25');
    expect(monthLabel('garbage', 'en', now)).toBe('garbage');
  });
});

describe('time zone', () => {
  it('reads an instant in the zone it is given', () => {
    const kolkata = formatDateTime('2026-10-02T20:30:00Z', 'en', 'Asia/Kolkata');
    const newYork = formatDateTime('2026-10-02T20:30:00Z', 'en', 'America/New_York');
    expect(kolkata).toContain('Oct 3');
    expect(newYork).toContain('Oct 2');
    expect(kolkata).not.toBe(newYork);
    expect(formatDay('2026-10-02T20:30:00Z', 'en', 'Asia/Kolkata')).toContain('Oct 3');
    expect(formatDay('2026-10-02T20:30:00Z', 'en', 'America/New_York')).toContain('Oct 2');
  });

  it('leaves a date-only value alone', () => {
    expect(formatDay('2026-03-05', 'en', 'Asia/Kolkata')).toBe('Mar 5, 2026');
  });
});

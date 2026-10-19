import { describe, expect, it } from 'vitest';
import type { ContactMeetingResponse } from '@crm/contracts';
import {
  addMinutes,
  asLink,
  draftOf,
  emptyInlineMeeting,
  groupMeetings,
  minutesBetween,
  nextHour,
  valuesOf,
} from './meeting-inline';

const meeting = (over: Partial<ContactMeetingResponse> = {}): ContactMeetingResponse => ({
  id: '6c1e1a7f-0000-4000-8000-000000000001',
  contactId: '294dca7c-5806-4548-9035-dcca9befc7b1',
  title: 'Demo',
  startsAt: '2026-10-20T10:00:00.000Z',
  endsAt: '2026-10-20T10:30:00.000Z',
  location: null,
  createdBy: null,
  rowVersion: 1,
  createdAt: '2026-10-16T09:30:00.000Z',
  updatedAt: '2026-10-16T09:30:00.000Z',
  ...over,
});

describe('wall-clock arithmetic', () => {
  it('adds minutes across the hour, the day and the month', () => {
    expect(addMinutes('2026-10-16T14:30', 30)).toBe('2026-10-16T15:00');
    expect(addMinutes('2026-10-16T23:45', 30)).toBe('2026-10-17T00:15');
    expect(addMinutes('2026-10-31T23:30', 60)).toBe('2026-11-01T00:30');
    expect(addMinutes('', 30)).toBe('');
  });

  it('measures the gap between two times, null when one is missing', () => {
    expect(minutesBetween('2026-10-16T14:00', '2026-10-16T15:30')).toBe(90);
    expect(minutesBetween('', '2026-10-16T15:30')).toBeNull();
  });

  it('starts a new meeting on the next whole hour, in the given zone', () => {
    // 09:10 UTC is 14:40 in Kolkata: the next whole hour there is 15:00.
    expect(nextHour(new Date('2026-10-16T09:10:00Z'), 'Asia/Kolkata')).toBe('2026-10-16T15:00');
    expect(nextHour(new Date('2026-10-16T09:00:00Z'), 'UTC')).toBe('2026-10-16T10:00');
  });
});

describe('the inline row and the request it makes', () => {
  it('starts with a 30 minute meeting on the next hour', () => {
    const d = emptyInlineMeeting(new Date('2026-10-16T09:10:00Z'), 'UTC');
    expect(d).toMatchObject({ title: '', startsAt: '2026-10-16T10:00', duration: '30' });
    expect(valuesOf({ ...d, title: 'Call' })).toMatchObject({
      title: 'Call',
      startsAt: '2026-10-16T10:00',
      endsAt: '2026-10-16T10:30',
      location: '',
    });
  });

  it('works the end out from the duration, leaves it out for "no end" and keeps a custom one', () => {
    const base = emptyInlineMeeting(new Date('2026-10-16T09:10:00Z'), 'UTC');
    expect(valuesOf({ ...base, duration: '90' }).endsAt).toBe('2026-10-16T11:30');
    expect(valuesOf({ ...base, duration: 'none' }).endsAt).toBe('');
    expect(valuesOf({ ...base, duration: 'custom', endsAt: '2026-10-17T09:00' }).endsAt).toBe(
      '2026-10-17T09:00',
    );
    // No start, no end to work out.
    expect(valuesOf({ ...base, startsAt: '' }).endsAt).toBe('');
  });

  it('reads an existing meeting back: an offered length is a choice, any other end is kept as custom', () => {
    expect(draftOf(meeting(), 'UTC')).toMatchObject({
      duration: '30',
      startsAt: '2026-10-20T10:00',
    });
    expect(draftOf(meeting({ endsAt: '2026-10-20T10:50:00.000Z' }), 'UTC')).toMatchObject({
      duration: 'custom',
      endsAt: '2026-10-20T10:50',
    });
    expect(draftOf(meeting({ endsAt: null }), 'UTC').duration).toBe('none');
    expect(
      draftOf(meeting({ startsAt: null, endsAt: null, location: 'Room 4' }), 'UTC'),
    ).toMatchObject({
      startsAt: '',
      duration: 'none',
      location: 'Room 4',
    });
  });
});

describe('groupMeetings', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  it('puts what has not ended on the upcoming list, soonest first, and the rest on the past list, latest first', () => {
    const a = meeting({ id: 'a', startsAt: '2026-10-20T10:00:00Z', endsAt: null });
    const b = meeting({ id: 'b', startsAt: '2026-10-18T10:00:00Z', endsAt: null });
    const c = meeting({ id: 'c', startsAt: '2026-10-01T10:00:00Z', endsAt: null });
    const d = meeting({ id: 'd', startsAt: '2026-10-10T10:00:00Z', endsAt: null });
    const g = groupMeetings([a, c, b, d], now);
    expect(g.upcoming.map((m) => m.id)).toEqual(['b', 'a']);
    expect(g.past.map((m) => m.id)).toEqual(['d', 'c']);
    expect(g.undated).toEqual([]);
  });

  it('keeps a meeting that has started but not ended in the upcoming list, and a meeting with no start on its own', () => {
    const running = meeting({
      id: 'r',
      startsAt: '2026-10-16T11:30:00Z',
      endsAt: '2026-10-16T12:30:00Z',
    });
    const open = meeting({ id: 'u', startsAt: null, endsAt: null });
    const g = groupMeetings([running, open], now);
    expect(g.upcoming.map((m) => m.id)).toEqual(['r']);
    expect(g.undated.map((m) => m.id)).toEqual(['u']);
  });
});

describe('groupMeetings and closed bookings', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  it('a cancelled or declined booking in the future sits with the past ones, tagged; a pending or confirmed one stays upcoming', () => {
    const base = { startsAt: '2026-10-20T10:00:00Z', endsAt: null, source: 'booking' as const };
    const cancelled = meeting({ id: 'c', ...base, status: 'cancelled' });
    const declined = meeting({ id: 'd', ...base, status: 'declined' });
    const pending = meeting({ id: 'p', ...base, status: 'pending' });
    const confirmed = meeting({ id: 'k', ...base, status: 'confirmed' });
    const g = groupMeetings([cancelled, declined, pending, confirmed], now);
    expect(g.upcoming.map((m) => m.id).sort()).toEqual(['k', 'p']);
    expect(g.past.map((m) => m.id).sort()).toEqual(['c', 'd']);
  });
});

describe('asLink', () => {
  it('accepts a web address and nothing else', () => {
    expect(asLink('https://meet.example.com/abc')).toBe('https://meet.example.com/abc');
    expect(asLink('  http://a.test/x ')).toBe('http://a.test/x');
    for (const no of [
      'Room 4',
      'javascript:alert(1)',
      'ftp://x.test',
      '',
      null,
      undefined,
      'https://',
    ]) {
      expect(asLink(no as string | null | undefined), String(no)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { PreviewDraft } from '../api/schemas';
import { groupSlotsByDay, slotClock } from './slots';
import { generateSlots, windowsFor } from './slot-engine';

const draft = (over: Partial<PreviewDraft> = {}): PreviewDraft => ({
  timezone: 'UTC',
  durationMinutes: 60,
  incrementMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 30,
  maxPerDay: null,
  capacity: 1,
  availability: [{ weekday: 1, from: '09:00', to: '12:00' }],
  overrides: [],
  ...over,
});

// Monday 5 October 2026, midnight UTC; "now" is the Friday before.
const NOW = new Date('2026-10-02T12:00:00Z');
const MON = new Date('2026-10-05T00:00:00Z');
const TUE = new Date('2026-10-06T00:00:00Z');
const clocks = (slots: Array<{ start: string }>, zone = 'UTC') =>
  slots.map((s) => slotClock(s.start, zone));

describe('generateSlots', () => {
  it('cuts a window into steps that fit the duration', () => {
    const slots = generateSlots({ draft: draft(), now: NOW, from: MON, to: TUE });
    expect(clocks(slots)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('uses the start step, not the duration, between starts', () => {
    const slots = generateSlots({
      draft: draft({ incrementMinutes: 30 }),
      now: NOW,
      from: MON,
      to: TUE,
    });
    expect(clocks(slots)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('offers nothing on a day with no window', () => {
    expect(
      generateSlots({ draft: draft(), now: NOW, from: TUE, to: new Date('2026-10-07T00:00:00Z') }),
    ).toEqual([]);
  });

  it('honours minimum notice and the booking horizon', () => {
    // From Sunday 13:00 UTC, 22 hours of notice is Monday 11:00, and a start exactly at the limit is allowed; 24 hours leaves nothing.
    const early = new Date('2026-10-04T13:00:00Z');
    expect(
      clocks(
        generateSlots({
          draft: draft({ minNoticeMinutes: 22 * 60 }),
          now: early,
          from: MON,
          to: TUE,
        }),
      ),
    ).toEqual(['11:00']);
    expect(
      generateSlots({
        draft: draft({ minNoticeMinutes: 24 * 60 }),
        now: early,
        from: MON,
        to: TUE,
      }),
    ).toEqual([]);
    expect(
      clocks(
        generateSlots({
          draft: draft({ minNoticeMinutes: 10 * 60 }),
          now: NOW,
          from: MON,
          to: TUE,
        }),
      ),
    ).toHaveLength(3);
    // A horizon of 1 day from Friday ends before Monday.
    expect(
      generateSlots({ draft: draft({ maxAdvanceDays: 1 }), now: NOW, from: MON, to: TUE }),
    ).toEqual([]);
    expect(
      generateSlots({ draft: draft({ maxAdvanceDays: 3 }), now: NOW, from: MON, to: TUE }),
    ).toHaveLength(3);
  });

  it('drops a closed date and uses the hours of an open override', () => {
    const closed = draft({
      overrides: [{ date: '2026-10-05', closed: true, from: null, to: null, reason: 'Holiday' }],
    });
    expect(generateSlots({ draft: closed, now: NOW, from: MON, to: TUE })).toEqual([]);
    const custom = draft({
      overrides: [{ date: '2026-10-05', closed: false, from: '14:00', to: '16:00', reason: null }],
    });
    expect(clocks(generateSlots({ draft: custom, now: NOW, from: MON, to: TUE }))).toEqual([
      '14:00',
      '15:00',
    ]);
    // An override can open a day the weekly hours leave closed.
    const open = draft({
      overrides: [{ date: '2026-10-06', closed: false, from: '10:00', to: '11:00', reason: null }],
    });
    expect(
      clocks(
        generateSlots({ draft: open, now: NOW, from: TUE, to: new Date('2026-10-07T00:00:00Z') }),
      ),
    ).toEqual(['10:00']);
  });

  it('removes a booked slot and the ones its buffers touch', () => {
    const busy = [
      {
        start: Date.parse('2026-10-05T10:00:00Z'),
        end: Date.parse('2026-10-05T11:00:00Z'),
        seats: 1,
      },
    ];
    expect(clocks(generateSlots({ draft: draft(), now: NOW, from: MON, to: TUE, busy }))).toEqual([
      '09:00',
      '11:00',
    ]);
    const buffered = generateSlots({
      draft: draft({ bufferAfterMinutes: 15 }),
      now: NOW,
      from: MON,
      to: TUE,
      busy,
    });
    // 09:00 + 60 + 15 buffer reaches into the 10:00 booking; 11:00 starts after it; 11:00 minus a 15 min buffer is fine.
    expect(clocks(buffered)).toEqual(['11:00']);
  });

  it('counts seats for a shared slot', () => {
    const busy = [
      {
        start: Date.parse('2026-10-05T09:00:00Z'),
        end: Date.parse('2026-10-05T10:00:00Z'),
        seats: 1,
      },
    ];
    const full = generateSlots({
      draft: draft({ capacity: 1 }),
      now: NOW,
      from: MON,
      to: TUE,
      busy,
    });
    expect(clocks(full)).toEqual(['10:00', '11:00']);
    const shared = generateSlots({
      draft: draft({ capacity: 3 }),
      now: NOW,
      from: MON,
      to: TUE,
      busy,
    });
    expect(shared.map((s) => [slotClock(s.start, 'UTC'), s.remaining])).toEqual([
      ['09:00', 2],
      ['10:00', 3],
      ['11:00', 3],
    ]);
  });

  it('stops offering a day that already holds its cap of bookings', () => {
    const busy = [
      {
        start: Date.parse('2026-10-05T10:00:00Z'),
        end: Date.parse('2026-10-05T11:00:00Z'),
        seats: 1,
      },
    ];
    expect(
      generateSlots({ draft: draft({ maxPerDay: 1 }), now: NOW, from: MON, to: TUE, busy }),
    ).toEqual([]);
    expect(
      generateSlots({ draft: draft({ maxPerDay: 2 }), now: NOW, from: MON, to: TUE, busy }),
    ).toHaveLength(2);
  });

  it('works in the type zone, whatever the zone of the caller', () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC.
    const slots = generateSlots({
      draft: draft({ timezone: 'Asia/Kolkata' }),
      now: NOW,
      from: new Date('2026-10-04T18:30:00Z'),
      to: new Date('2026-10-05T18:30:00Z'),
    });
    expect(slots[0]!.start).toBe('2026-10-05T03:30:00.000Z');
    expect(clocks(slots, 'Asia/Kolkata')).toEqual(['09:00', '10:00', '11:00']);
  });

  it('keeps the same wall hours across a daylight saving change', () => {
    const d = draft({
      timezone: 'America/New_York',
      availability: [{ weekday: 0, from: '09:00', to: '11:00' }],
    });
    // Sunday 8 March 2026 (clocks went forward at 02:00) and Sunday 1 March, a week before.
    const after = generateSlots({
      draft: d,
      now: new Date('2026-03-01T00:00:00Z'),
      from: new Date('2026-03-08T00:00:00Z'),
      to: new Date('2026-03-09T12:00:00Z'),
    });
    const before = generateSlots({
      draft: d,
      now: new Date('2026-02-20T00:00:00Z'),
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-03-02T12:00:00Z'),
    });
    expect(after.map((s) => s.start)).toEqual([
      '2026-03-08T13:00:00.000Z',
      '2026-03-08T14:00:00.000Z',
    ]);
    expect(before.map((s) => s.start)).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-03-01T15:00:00.000Z',
    ]);
  });

  it('offers nothing at a wall time the zone skips and nothing twice', () => {
    const d = draft({
      timezone: 'America/New_York',
      availability: [{ weekday: 0, from: '00:00', to: '06:00' }],
      incrementMinutes: 60,
    });
    const slots = generateSlots({
      draft: d,
      now: new Date('2026-03-01T00:00:00Z'),
      from: new Date('2026-03-08T00:00:00Z'),
      to: new Date('2026-03-09T12:00:00Z'),
    });
    // 00:00, 01:00, (02:00 does not exist), 03:00, 04:00, 05:00
    expect(clocks(slots, 'America/New_York')).toEqual([
      '00:00',
      '01:00',
      '03:00',
      '04:00',
      '05:00',
    ]);
    expect(new Set(slots.map((s) => s.start)).size).toBe(slots.length);
  });

  it('groups for a visitor in another zone', () => {
    const slots = generateSlots({
      draft: draft({
        timezone: 'Asia/Tokyo',
        availability: [{ weekday: 1, from: '20:00', to: '23:00' }],
      }),
      now: NOW,
      from: new Date('2026-10-04T15:00:00Z'),
      to: new Date('2026-10-05T15:00:00Z'),
    });
    // 20:00 to 22:00 in Tokyo is 11:00 to 13:00 UTC and 04:00 to 06:00 in Los Angeles, the same calendar day (Monday).
    expect(groupSlotsByDay(slots, 'America/Los_Angeles').map((g) => g.day)).toEqual(['2026-10-05']);
    expect(groupSlotsByDay(slots, 'Asia/Tokyo').map((g) => g.day)).toEqual(['2026-10-05']);
    // From Auckland (UTC+13 in October) the same slots are early on Tuesday.
    expect(groupSlotsByDay(slots, 'Pacific/Auckland').map((g) => g.day)).toEqual(['2026-10-06']);
  });

  it('stops at the limit', () => {
    expect(generateSlots({ draft: draft(), now: NOW, from: MON, to: TUE, limit: 2 })).toHaveLength(
      2,
    );
  });
});

describe('windowsFor', () => {
  it('ignores unreadable and reversed windows', () => {
    const d = draft({
      availability: [
        { weekday: 1, from: '12:00', to: '11:00' },
        { weekday: 1, from: 'x', to: '11:00' },
        { weekday: 1, from: '14:00', to: '15:00' },
      ],
    });
    expect(windowsFor('2026-10-05', d)).toEqual([{ from: 840, to: 900 }]);
  });
});

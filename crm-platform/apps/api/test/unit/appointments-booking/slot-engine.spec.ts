import { describe, expect, it } from 'vitest';
import {
  bookableRange,
  clashesWithBuffers,
  dayWindows,
  findOpenSlot,
  freeSeats,
  generateSlots,
  pickSeat,
  type EngineInput,
  type EngineType,
} from '../../../src/modules/appointments-booking/slot-engine';

const MIN = 60_000;
const H = 60 * MIN;
const at = (s: string) => Date.parse(s);
const hhmm = (ms: number, offsetH = 0) => new Date(ms + offsetH * H).toISOString().slice(11, 16);

const base: EngineType = {
  timezone: 'UTC',
  durationMinutes: 30,
  incrementMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 30,
  maxPerDay: null,
  capacity: 1,
};

/** Monday 5 October 2026, 00:00 UTC: "now" for most tests. */
const NOW = at('2026-10-05T00:00:00Z');

function input(
  over: Omit<Partial<EngineInput>, 'type'> & { type?: Partial<EngineType> } = {},
): EngineInput {
  const { type, ...rest } = over;
  return {
    type: { ...base, ...type },
    windows: [{ weekday: 1, from: '09:00', to: '12:00' }],
    overrides: [],
    bookings: [],
    busy: [],
    holds: [],
    nowMs: NOW,
    fromDate: '2026-10-05',
    toDate: '2026-10-05',
    ...rest,
  };
}

const starts = (i: EngineInput) =>
  generateSlots(i).flatMap((d) => d.slots.map((s) => hhmm(s.startMs)));

describe('the candidate grid (WD-APPT-017)', () => {
  it('steps by the increment inside the interval and needs the whole duration to fit', () => {
    expect(starts(input())).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    expect(starts(input({ type: { durationMinutes: 60, incrementMinutes: 60 } }))).toEqual([
      '09:00',
      '10:00',
      '11:00',
    ]);
    // A 45-minute service on a 30-minute step: the last start that still fits is 11:00 (ends 11:45).
    expect(starts(input({ type: { durationMinutes: 45, incrementMinutes: 30 } }))).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('a day with no interval is closed; two intervals of a day are both used; overlapping ones do not duplicate a start', () => {
    expect(starts(input({ windows: [{ weekday: 2, from: '09:00', to: '12:00' }] }))).toEqual([]);
    expect(
      starts(
        input({
          windows: [
            { weekday: 1, from: '09:00', to: '10:00' },
            { weekday: 1, from: '14:00', to: '15:00' },
          ],
        }),
      ),
    ).toEqual(['09:00', '09:30', '14:00', '14:30']);
    expect(
      starts(
        input({
          windows: [
            { weekday: 1, from: '09:00', to: '11:00' },
            { weekday: 1, from: '10:00', to: '12:00' },
          ],
        }),
      ),
    ).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('reports the seats left (remaining) and the instants', () => {
    const [day] = generateSlots(input());
    expect(day!.date).toBe('2026-10-05');
    expect(day!.slots[0]).toEqual({
      startMs: at('2026-10-05T09:00:00Z'),
      endMs: at('2026-10-05T09:30:00Z'),
      remaining: 1,
    });
  });
});

describe('minimum notice and the booking horizon', () => {
  it('drops slots earlier than now + notice (to the minute)', () => {
    const now = at('2026-10-05T08:00:00Z');
    expect(starts(input({ nowMs: now, type: { minNoticeMinutes: 90 } }))).toEqual([
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
    expect(starts(input({ nowMs: now, type: { minNoticeMinutes: 60 } }))[0]).toBe('09:00');
  });

  it('the horizon is maxAdvanceDays calendar days, today counted as the first', () => {
    const wd = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: '09:00', to: '09:30' }));
    const range = bookableRange({ timezone: 'UTC', maxAdvanceDays: 3 }, NOW);
    expect(range).toEqual({ first: '2026-10-05', last: '2026-10-07' });
    const days = generateSlots(
      input({
        windows: wd,
        type: { maxAdvanceDays: 3 },
        fromDate: '2026-10-01',
        toDate: '2026-11-30',
      }),
    );
    expect(days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('a past date never yields a slot, even when asked for', () => {
    expect(generateSlots(input({ fromDate: '2026-09-28', toDate: '2026-09-28' }))).toEqual([]);
  });
});

describe("buffers (D-02: WaDesk's rule kept)", () => {
  const booking = {
    startMs: at('2026-10-05T10:00:00Z'),
    endMs: at('2026-10-05T11:00:00Z'),
    seat: 1,
  };

  it('the gap after an existing booking is bufferBefore, the gap before the next is bufferAfter', () => {
    expect(
      starts(
        input({
          bookings: [booking],
          type: {
            durationMinutes: 60,
            incrementMinutes: 30,
            bufferBeforeMinutes: 15,
            bufferAfterMinutes: 0,
          },
        }),
      ),
    ).toEqual(['09:00']);
    // bufferBefore 15 with a 30-minute service on a 15-minute step: a start clashes when it ends after 10:00 (so 09:45 is out)
    // or starts less than 15 minutes after 11:00 (so 11:00 is out and 11:15 is the first free start).
    expect(
      starts(
        input({
          bookings: [booking],
          windows: [{ weekday: 1, from: '09:00', to: '13:00' }],
          type: { durationMinutes: 30, incrementMinutes: 15, bufferBeforeMinutes: 15 },
        }),
      ),
    ).toEqual(['09:00', '09:15', '09:30', '11:15', '11:30', '11:45', '12:00', '12:15', '12:30']);
  });

  it('a slot that would end right where the next booking starts needs bufferAfter of room', () => {
    // 09:30-10:00 touches the 10:00 booking: allowed with no buffer after, refused with 15.
    expect(
      starts(input({ bookings: [booking], type: { durationMinutes: 30, bufferAfterMinutes: 0 } })),
    ).toContain('09:30');
    expect(
      starts(input({ bookings: [booking], type: { durationMinutes: 30, bufferAfterMinutes: 15 } })),
    ).not.toContain('09:30');
  });

  it('clashesWithBuffers: touching intervals do not clash without a buffer', () => {
    const o = { startMs: 10 * H, endMs: 11 * H };
    expect(clashesWithBuffers(11 * H, 12 * H, o, 0, 0)).toBe(false);
    expect(clashesWithBuffers(11 * H, 12 * H, o, 1, 0)).toBe(true);
    expect(clashesWithBuffers(9 * H, 10 * H, o, 0, 0)).toBe(false);
    expect(clashesWithBuffers(9 * H, 10 * H, o, 0, 1)).toBe(true);
  });

  it('busy time from an external calendar blocks every seat, with the same buffers', () => {
    const busy = [{ startMs: at('2026-10-05T10:00:00Z'), endMs: at('2026-10-05T10:30:00Z') }];
    expect(starts(input({ busy }))).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
    expect(starts(input({ busy, type: { capacity: 3 } }))).toEqual([
      '09:00',
      '09:30',
      '10:30',
      '11:00',
      '11:30',
    ]);
  });
});

describe('date overrides (D-03)', () => {
  it("a closed date removes the day; special hours replace that date's weekly intervals", () => {
    expect(
      starts(input({ overrides: [{ date: '2026-10-05', isClosed: true, from: null, to: null }] })),
    ).toEqual([]);
    expect(
      starts(
        input({ overrides: [{ date: '2026-10-05', isClosed: false, from: '14:00', to: '15:00' }] }),
      ),
    ).toEqual(['14:00', '14:30']);
    // Special hours open a day that has no weekly interval at all.
    expect(
      starts(
        input({
          windows: [],
          overrides: [{ date: '2026-10-05', isClosed: false, from: '10:00', to: '11:00' }],
        }),
      ),
    ).toEqual(['10:00', '10:30']);
  });
  it('an override of another date changes nothing', () => {
    expect(
      dayWindows(
        '2026-10-05',
        [{ weekday: 1, from: '09:00', to: '10:00' }],
        [{ date: '2026-10-12', isClosed: true, from: null, to: null }],
      ),
    ).toEqual([{ from: '09:00', to: '10:00' }]);
  });
});

describe('capacity, seats and reservations (WD-APPT-018)', () => {
  const t: Partial<EngineType> = { capacity: 3 };
  const full = (seat: number) => ({
    startMs: at('2026-10-05T09:00:00Z'),
    endMs: at('2026-10-05T09:30:00Z'),
    seat,
  });

  it('a group slot stays open until every seat is taken, and counts what is left', () => {
    const open = generateSlots(input({ type: t, bookings: [full(1), full(2)] }))[0]!.slots[0]!;
    expect(open.remaining).toBe(1);
    expect(starts(input({ type: t, bookings: [full(1), full(2), full(3)] }))[0]).toBe('09:30');
  });

  it('pickSeat takes the lowest free seat; a freed lower seat is reused', () => {
    const s = (seat: number) => ({ ...full(seat) });
    const type = { ...base, ...t };
    expect(pickSeat(type, [], full(1).startMs, full(1).endMs)).toBe(1);
    expect(pickSeat(type, [s(1), s(3)], full(1).startMs, full(1).endMs)).toBe(2);
    expect(pickSeat(type, [s(1), s(2), s(3)], full(1).startMs, full(1).endMs)).toBeNull();
    expect(freeSeats(type, [s(2)], full(1).startMs, full(1).endMs)).toEqual([1, 3]);
  });

  it('buffers apply per seat: a different-start booking on a seat blocks that seat only', () => {
    const type = { ...base, capacity: 2, bufferBeforeMinutes: 30 };
    // Seat 1 is booked 08:30-09:30; a 09:30 start needs 30 minutes after its end, so seat 1 is blocked and seat 2 is free.
    const b = { startMs: at('2026-10-05T08:30:00Z'), endMs: at('2026-10-05T09:30:00Z'), seat: 1 };
    expect(freeSeats(type, [b], at('2026-10-05T09:30:00Z'), at('2026-10-05T10:00:00Z'))).toEqual([
      2,
    ]);
    expect(freeSeats(type, [b], at('2026-10-05T10:00:00Z'), at('2026-10-05T10:30:00Z'))).toEqual([
      1, 2,
    ]);
  });

  it('a live reservation holds a seat, and the last seat is not given away twice', () => {
    const hold = { startMs: full(1).startMs, endMs: full(1).endMs, seats: 1 };
    expect(starts(input({ holds: [hold] }))[0]).toBe('09:30');
    const [d] = generateSlots(input({ type: t, holds: [hold], bookings: [full(1)] }));
    expect(d!.slots[0]!.remaining).toBe(1);
  });

  it('bookings above the capacity (left from a cut) do not count as blocking a real seat', () => {
    expect(freeSeats({ ...base, capacity: 1 }, [full(5)], full(1).startMs, full(1).endMs)).toEqual([
      1,
    ]);
  });
});

describe('the per-day cap counts bookings, not offered slots (D-02)', () => {
  const b = (h: number) => ({
    startMs: at(`2026-10-05T${String(h).padStart(2, '0')}:00:00Z`),
    endMs: at(`2026-10-05T${String(h).padStart(2, '0')}:30:00Z`),
    seat: 1,
  });
  it('offers the whole day until maxPerDay bookings start on it', () => {
    expect(starts(input({ type: { maxPerDay: 2 }, bookings: [b(9)] }))).toEqual([
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
    expect(starts(input({ type: { maxPerDay: 2 }, bookings: [b(9), b(10)] }))).toEqual([]);
  });
  it("the day is the type's local day", () => {
    // 22:00 UTC on the 4th is 03:30 on the 5th in Kolkata: it counts against the 5th there.
    const kolkata = { timezone: 'Asia/Kolkata', maxPerDay: 1 };
    const late = {
      startMs: at('2026-10-04T22:00:00Z'),
      endMs: at('2026-10-04T22:30:00Z'),
      seat: 1,
    };
    expect(
      starts(input({ type: kolkata, bookings: [late], nowMs: at('2026-10-04T00:00:00Z') })),
    ).toEqual([]);
  });
});

describe('time zones and daylight saving (D-01)', () => {
  const ny = { timezone: 'America/New_York' };
  const nyNow = at('2026-03-01T00:00:00Z');

  it('a half-hour zone: a 09:00 Kolkata window is 03:30 UTC', () => {
    const s = generateSlots(input({ type: { timezone: 'Asia/Kolkata' } }))[0]!.slots[0]!;
    expect(new Date(s.startMs).toISOString()).toBe('2026-10-05T03:30:00.000Z');
  });

  it('the same 09:00 slot is an hour earlier in UTC after spring forward (New York, 7 vs 9 March 2026)', () => {
    const before = generateSlots({
      ...input({ type: ny, nowMs: nyNow }),
      windows: [{ weekday: 6, from: '09:00', to: '09:30' }],
      fromDate: '2026-03-07',
      toDate: '2026-03-07',
    })[0]!.slots[0]!;
    const after = generateSlots({
      ...input({ type: ny, nowMs: nyNow }),
      windows: [{ weekday: 1, from: '09:00', to: '09:30' }],
      fromDate: '2026-03-09',
      toDate: '2026-03-09',
    })[0]!.slots[0]!;
    expect(new Date(before.startMs).toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
    expect(new Date(after.startMs).toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
  });

  it('spring forward day: a 00:00-08:00 window is 7 real hours (14 half-hour slots), not 16', () => {
    const win = [{ weekday: 0, from: '00:00', to: '08:00' }];
    const day = generateSlots({
      ...input({ type: ny, nowMs: nyNow }),
      windows: win,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
    })[0]!;
    expect(day.slots).toHaveLength(14);
    // 02:00 and 02:30 do not exist: no slot starts at a wall time that is not on the clock.
    const wall = day.slots.map((s) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(s.startMs)),
    );
    expect(wall).not.toContain('02:00');
    expect(wall).not.toContain('02:30');
    expect(wall).toContain('03:00');
  });

  it('a window that lies entirely inside the gap yields nothing', () => {
    const win = [{ weekday: 0, from: '02:00', to: '03:00' }];
    const day = generateSlots({
      ...input({ type: ny, nowMs: nyNow }),
      windows: win,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
    });
    expect(day).toEqual([]);
  });

  it('fall back day: a 00:00-08:00 window is 9 real hours (18 slots); the repeated hour is offered twice', () => {
    const win = [{ weekday: 0, from: '00:00', to: '08:00' }];
    const day = generateSlots({
      ...input({ type: ny, nowMs: at('2026-10-30T00:00:00Z') }),
      windows: win,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
    })[0]!;
    expect(day.slots).toHaveLength(18);
    const step = new Set(day.slots.slice(1).map((s, i) => s.startMs - day.slots[i]!.startMs));
    expect([...step]).toEqual([30 * MIN]);
  });

  it('a 09:00-17:00 day is the same 16 slots on a DST day as on any other', () => {
    const win = [{ weekday: 0, from: '09:00', to: '17:00' }];
    const spring = generateSlots({
      ...input({ type: ny, nowMs: nyNow }),
      windows: win,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
    })[0]!;
    expect(spring.slots).toHaveLength(16);
  });

  it('"today" is the type\'s date: late evening UTC is already tomorrow in Kolkata', () => {
    expect(
      bookableRange({ timezone: 'Asia/Kolkata', maxAdvanceDays: 2 }, at('2026-10-05T20:00:00Z')),
    ).toEqual({ first: '2026-10-06', last: '2026-10-07' });
  });
});

describe('findOpenSlot: the check every booking runs under the lock', () => {
  it('finds a slot that is on the grid and free, and nothing else', () => {
    const i = input();
    expect(findOpenSlot(i, at('2026-10-05T09:30:00Z'))?.remaining).toBe(1);
    expect(findOpenSlot(i, at('2026-10-05T09:37:00Z'))).toBeNull(); // off the grid
    expect(findOpenSlot(i, at('2026-10-05T12:00:00Z'))).toBeNull(); // after the window
    expect(findOpenSlot(i, at('2026-10-06T09:00:00Z'))).toBeNull(); // Tuesday: closed
    const taken = {
      startMs: at('2026-10-05T09:30:00Z'),
      endMs: at('2026-10-05T10:00:00Z'),
      seat: 1,
    };
    expect(findOpenSlot({ ...i, bookings: [taken] }, at('2026-10-05T09:30:00Z'))).toBeNull();
  });
});

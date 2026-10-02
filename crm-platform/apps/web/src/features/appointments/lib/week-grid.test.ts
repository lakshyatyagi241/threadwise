import { describe, expect, it } from 'vitest';
import {
  clipToDay,
  eventBox,
  eventsOnDay,
  hourRange,
  layoutDay,
  monthSpan,
  nowMinutes,
  rangeOf,
  weekDays,
} from './week-grid';

const ev = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });
const Z = 'UTC';

describe('weekDays', () => {
  it('lists seven days from the start of the week', () => {
    expect(weekDays('2026-10-02', 1)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weekDays('2026-10-02', 0)[0]).toBe('2026-09-27');
  });
});

describe('clipToDay', () => {
  it('returns grid minutes for an event on the day and null for one that is not', () => {
    const e = ev('a', '2026-10-05T09:30:00Z', '2026-10-05T10:15:00Z');
    expect(clipToDay(e, '2026-10-05', Z)).toEqual({ startMin: 570, endMin: 615 });
    expect(clipToDay(e, '2026-10-04', Z)).toBeNull();
    expect(clipToDay(e, '2026-10-06', Z)).toBeNull();
  });

  it('reads the clock in the display zone', () => {
    const e = ev('a', '2026-10-05T09:30:00Z', '2026-10-05T10:00:00Z');
    expect(clipToDay(e, '2026-10-05', 'Asia/Kolkata')).toEqual({
      startMin: 15 * 60,
      endMin: 15 * 60 + 30,
    });
    // 22:00 UTC is 03:30 the next morning in Kolkata.
    const late = ev('b', '2026-10-05T22:00:00Z', '2026-10-05T22:30:00Z');
    expect(clipToDay(late, '2026-10-05', 'Asia/Kolkata')).toBeNull();
    expect(clipToDay(late, '2026-10-06', 'Asia/Kolkata')).toEqual({
      startMin: 3 * 60 + 30,
      endMin: 4 * 60,
    });
  });

  it('cuts an event that crosses midnight at the day edges', () => {
    const e = ev('n', '2026-10-05T23:00:00Z', '2026-10-06T01:00:00Z');
    expect(clipToDay(e, '2026-10-05', Z)).toEqual({ startMin: 23 * 60, endMin: 24 * 60 });
    expect(clipToDay(e, '2026-10-06', Z)).toEqual({ startMin: 0, endMin: 60 });
  });

  it('ignores an event that ends exactly at the start of the day', () => {
    expect(
      clipToDay(ev('x', '2026-10-05T22:00:00Z', '2026-10-06T00:00:00Z'), '2026-10-06', Z),
    ).toBeNull();
  });

  it('places events on the 23-hour spring-forward day by wall clock', () => {
    // New York 8 March 2026: 09:00 EDT is 13:00Z.
    const e = ev('d', '2026-03-08T13:00:00Z', '2026-03-08T14:00:00Z');
    expect(clipToDay(e, '2026-03-08', 'America/New_York')).toEqual({
      startMin: 9 * 60,
      endMin: 10 * 60,
    });
  });
});

describe('layoutDay', () => {
  it('gives events that do not overlap a full-width column each', () => {
    const placed = layoutDay(
      [
        ev('a', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
        ev('b', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    expect(placed.map((p) => [p.event.id, p.col, p.cols])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('puts overlapping events side by side and shares the width', () => {
    const placed = layoutDay(
      [
        ev('a', '2026-10-05T09:00:00Z', '2026-10-05T11:00:00Z'),
        ev('b', '2026-10-05T09:30:00Z', '2026-10-05T10:30:00Z'),
        ev('c', '2026-10-05T10:00:00Z', '2026-10-05T10:45:00Z'),
        ev('d', '2026-10-05T13:00:00Z', '2026-10-05T14:00:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect([by.a!.col, by.b!.col, by.c!.col]).toEqual([0, 1, 2]);
    expect([by.a!.cols, by.b!.cols, by.c!.cols]).toEqual([3, 3, 3]);
    // The later event is a cluster of its own.
    expect([by.d!.col, by.d!.cols]).toEqual([0, 1]);
  });

  it('reuses a free column inside a cluster', () => {
    const placed = layoutDay(
      [
        ev('a', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
        ev('b', '2026-10-05T09:30:00Z', '2026-10-05T11:00:00Z'),
        ev('c', '2026-10-05T10:00:00Z', '2026-10-05T10:30:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(by.c!.col).toBe(0);
    expect(by.c!.cols).toBe(2);
  });

  it('treats two events at the same start as overlapping, whatever order they arrive in', () => {
    const a = layoutDay(
      [
        ev('x', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
        ev('y', '2026-10-05T09:00:00Z', '2026-10-05T09:30:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    const b = layoutDay(
      [
        ev('y', '2026-10-05T09:00:00Z', '2026-10-05T09:30:00Z'),
        ev('x', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    expect(a.map((p) => [p.event.id, p.col, p.cols])).toEqual(
      b.map((p) => [p.event.id, p.col, p.cols]),
    );
    expect(a.every((p) => p.cols === 2)).toBe(true);
  });

  it('lets a very short event overlap its neighbour by the height it is drawn at', () => {
    const placed = layoutDay(
      [
        ev('a', '2026-10-05T09:00:00Z', '2026-10-05T09:05:00Z'),
        ev('b', '2026-10-05T09:10:00Z', '2026-10-05T10:00:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    // 'a' is drawn 20 minutes tall, so 'b' at 09:10 would sit on top of it.
    expect(placed.every((p) => p.cols === 2)).toBe(true);
  });

  it('skips events of other days', () => {
    expect(
      layoutDay([ev('a', '2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z')], '2026-10-05', Z),
    ).toEqual([]);
  });
});

describe('hourRange and eventBox', () => {
  it('shows the working day when the week is empty', () => {
    expect(hourRange([], weekDays('2026-10-05', 1), Z)).toEqual({ from: 8, to: 19 });
  });

  it('widens to take in early and late events', () => {
    const days = weekDays('2026-10-05', 1);
    const range = hourRange(
      [
        ev('a', '2026-10-05T06:15:00Z', '2026-10-05T07:00:00Z'),
        ev('b', '2026-10-07T20:00:00Z', '2026-10-07T21:30:00Z'),
      ],
      days,
      Z,
    );
    expect(range).toEqual({ from: 6, to: 22 });
  });

  it('turns minutes into percentages of the visible hours', () => {
    const range = { from: 8, to: 18 };
    expect(eventBox({ startMin: 9 * 60, endMin: 10 * 60 }, range)).toEqual({ top: 10, height: 10 });
    // A 5-minute event is drawn at the minimum height.
    expect(eventBox({ startMin: 9 * 60, endMin: 9 * 60 + 5 }, range).height).toBeCloseTo(
      (20 / 600) * 100,
    );
  });
});

describe('helpers', () => {
  it('lists the events of a day in start order', () => {
    const list = eventsOnDay(
      [
        ev('b', '2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z'),
        ev('a', '2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z'),
        ev('c', '2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z'),
      ],
      '2026-10-05',
      Z,
    );
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('finds now on the grid only on today', () => {
    const now = new Date('2026-10-05T14:20:00Z');
    expect(nowMinutes(now, '2026-10-05', Z)).toBe(14 * 60 + 20);
    expect(nowMinutes(now, '2026-10-06', Z)).toBeNull();
  });

  it('turns a span of days into the range to ask the API for', () => {
    const r = rangeOf(weekDays('2026-10-05', 1), 'UTC');
    expect(r.from).toBe('2026-10-05T00:00:00.000Z');
    expect(r.to).toBe('2026-10-12T00:00:00.000Z');
  });

  it('covers whole weeks for the month view', () => {
    const span = monthSpan('2026-10-14', 1);
    expect(span[0]).toBe('2026-09-28');
    expect(span.at(-1)).toBe('2026-11-01');
    expect(span).toHaveLength(35);
  });
});

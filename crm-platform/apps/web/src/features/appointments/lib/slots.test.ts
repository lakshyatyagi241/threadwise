import { describe, expect, it } from 'vitest';
import {
  firstDayWithSlots,
  groupSlotsByDay,
  monthMatrix,
  slotClock,
  slotCounts,
  weekdayOrder,
  type Slot,
} from './slots';
import { zonedTimeToUtc } from './zone';

const slot = (iso: string, mins = 30): Slot => ({
  start: iso,
  end: new Date(Date.parse(iso) + mins * 60_000).toISOString(),
});

describe('groupSlotsByDay', () => {
  it('groups by the visitor day, not the UTC day', () => {
    const slots = [
      slot('2026-10-05T18:30:00Z'),
      slot('2026-10-05T19:00:00Z'),
      slot('2026-10-06T03:30:00Z'),
    ];
    // In Tokyo (UTC+9) the first two are on the 6th, early morning, and the third is the 6th at 12:30.
    const tokyo = groupSlotsByDay(slots, 'Asia/Tokyo');
    expect(tokyo.map((d) => [d.day, d.slots.length])).toEqual([['2026-10-06', 3]]);
    // In Los Angeles (UTC-7) all three are on the 5th.
    const la = groupSlotsByDay(slots, 'America/Los_Angeles');
    expect(la.map((d) => [d.day, d.slots.length])).toEqual([['2026-10-05', 3]]);
    // In UTC they split across two days.
    const utc = groupSlotsByDay(slots, 'UTC');
    expect(utc.map((d) => [d.day, d.slots.length])).toEqual([
      ['2026-10-05', 2],
      ['2026-10-06', 1],
    ]);
  });

  it('keeps time order, drops repeats and ignores unreadable starts', () => {
    const groups = groupSlotsByDay(
      [
        slot('2026-10-05T10:00:00Z'),
        slot('2026-10-05T09:00:00Z'),
        slot('2026-10-05T09:00:00Z'),
        { start: 'soon', end: 'later' },
      ],
      'UTC',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.slots.map((s) => s.start)).toEqual([
      '2026-10-05T09:00:00Z',
      '2026-10-05T10:00:00Z',
    ]);
  });

  it('counts every slot of a daylight-saving transition day once, on the right day', () => {
    // New York, 8 March 2026 is 23 hours long: hourly slots from 00:00 to 22:00 local are 23 starts.
    const zone = 'America/New_York';
    const slots: Slot[] = [];
    for (let m = 0; m < 24 * 60; m += 60) {
      const at = zonedTimeToUtc('2026-03-08', m, zone);
      // 02:00 is skipped, so two wall times map to the same instant; the grouping keeps one.
      slots.push(slot(at.toISOString(), 60));
    }
    const groups = groupSlotsByDay(slots, zone);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.day).toBe('2026-03-08');
    expect(groups[0]!.slots).toHaveLength(23);
    expect(new Set(groups[0]!.slots.map((s) => s.start)).size).toBe(23);
  });

  it('keeps both 01:30s of a fall-back day as separate slots', () => {
    const zone = 'America/New_York';
    const slots = [slot('2026-11-01T05:30:00Z'), slot('2026-11-01T06:30:00Z')];
    const g = groupSlotsByDay(slots, zone);
    expect(g).toHaveLength(1);
    expect(g[0]!.slots.map((s) => slotClock(s.start, zone))).toEqual(['01:30', '01:30']);
  });

  it('counts per day and finds the first open day', () => {
    const slots = [
      slot('2026-10-05T10:00:00Z'),
      slot('2026-10-07T10:00:00Z'),
      slot('2026-10-07T11:00:00Z'),
    ];
    const counts = slotCounts(slots, 'UTC');
    expect(counts.get('2026-10-07')).toBe(2);
    expect(counts.has('2026-10-06')).toBe(false);
    const groups = groupSlotsByDay(slots, 'UTC');
    expect(firstDayWithSlots(groups)).toBe('2026-10-05');
    expect(firstDayWithSlots(groups, '2026-10-06')).toBe('2026-10-07');
    expect(firstDayWithSlots(groups, '2026-10-08')).toBeNull();
    expect(firstDayWithSlots([])).toBeNull();
  });
});

describe('monthMatrix', () => {
  it('lays October 2026 out in whole weeks, Monday first', () => {
    const rows = monthMatrix('2026-10-14', 1);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows[0]![0]!.day).toBe('2026-09-28');
    expect(rows[0]![0]!.inMonth).toBe(false);
    expect(rows[0]![3]!.day).toBe('2026-10-01');
    expect(rows[0]![3]!.inMonth).toBe(true);
    expect(rows.at(-1)!.at(-1)!.day).toBe('2026-11-01');
    expect(rows).toHaveLength(5);
  });

  it('starts on Sunday when asked and needs six rows when the month spans six weeks', () => {
    const rows = monthMatrix('2026-08-10', 0);
    expect(rows[0]![0]!.day).toBe('2026-07-26');
    expect(rows).toHaveLength(6);
    expect(rows.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('fits February 2026, which starts on a Sunday, in four rows when weeks start on Sunday', () => {
    expect(monthMatrix('2026-02-10', 0)).toHaveLength(4);
    expect(monthMatrix('2026-02-10', 1)).toHaveLength(5);
  });

  it('orders the weekday headings', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addClosedDay,
  addClosedRange,
  addInterval,
  copyDay,
  dateStatus,
  dayMinutes,
  dayProblems,
  defaultWeek,
  emptyWeek,
  MAX_INTERVALS_PER_DAY,
  overrideProblems,
  overridesFromWire,
  overridesToWire,
  rulesFromWeek,
  sortIntervals,
  toggleClosedDay,
  weekFromRules,
  weekHasProblems,
  weekIsEmpty,
  weekMinutes,
  type Interval,
} from './availability';

const iv = (id: string, from: string, to: string): Interval => ({ id, from, to });

describe('weekly hours', () => {
  it('starts as Monday to Friday, 09:00 to 18:00', () => {
    const w = defaultWeek();
    expect(rulesFromWeek(w).map((r) => `${r.weekday} ${r.from}-${r.to}`)).toEqual([
      '1 09:00-18:00',
      '2 09:00-18:00',
      '3 09:00-18:00',
      '4 09:00-18:00',
      '5 09:00-18:00',
    ]);
    expect(weekMinutes(w)).toBe(5 * 9 * 60);
  });

  it('round-trips through the API shape, Sunday last in the editor and first on the wire order of the week', () => {
    const rules = [
      { weekday: 0, from: '10:00', to: '12:00' },
      { weekday: 1, from: '13:00:00', to: '17:00:00' },
      { weekday: 1, from: '09:00', to: '12:00' },
    ];
    const w = weekFromRules(rules);
    expect(w[1].map((x) => [x.from, x.to])).toEqual([
      ['09:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    // Monday first, Sunday last.
    expect(rulesFromWeek(w).map((r) => r.weekday)).toEqual([1, 1, 0]);
  });

  it('drops rules with an unreadable weekday and rows with an unfinished time', () => {
    const w = weekFromRules([{ weekday: 9, from: '09:00', to: '10:00' }]);
    expect(weekIsEmpty(w)).toBe(true);
    const half = emptyWeek();
    half[2] = [iv('a', '09:00', ''), iv('b', '', '10:00'), iv('c', '11:00', '12:00')];
    expect(rulesFromWeek(half)).toEqual([{ weekday: 2, from: '11:00', to: '12:00' }]);
  });

  it('says a week with no rows is empty and closed', () => {
    expect(weekIsEmpty(emptyWeek())).toBe(true);
    expect(weekIsEmpty(defaultWeek())).toBe(false);
  });
});

describe('interval problems', () => {
  it('flags an empty box, an end before the start and overlaps', () => {
    const problems = dayProblems([
      iv('a', '09:00', '12:00'),
      iv('b', '11:00', '13:00'),
      iv('c', '14:00', '14:00'),
      iv('d', '', '15:00'),
      iv('e', '16:00', '17:00'),
    ]);
    expect(problems.get('a')).toBe('overlap');
    expect(problems.get('b')).toBe('overlap');
    expect(problems.get('c')).toBe('order');
    expect(problems.get('d')).toBe('incomplete');
    expect(problems.has('e')).toBe(false);
  });

  it('lets two intervals touch', () => {
    expect(dayProblems([iv('a', '09:00', '12:00'), iv('b', '12:00', '15:00')]).size).toBe(0);
  });

  it('treats a day without rows as closed, not as a problem', () => {
    const w = emptyWeek();
    expect(weekHasProblems(w)).toBe(false);
    w[3] = [iv('x', '10:00', '09:00')];
    expect(weekHasProblems(w)).toBe(true);
  });

  it('sorts by start and sends unfinished rows last', () => {
    expect(
      sortIntervals([
        iv('a', '', '10:00'),
        iv('b', '13:00', '14:00'),
        iv('c', '09:00', '10:00'),
      ]).map((x) => x.id),
    ).toEqual(['c', 'b', 'a']);
  });
});

describe('editing a day', () => {
  it('adds a row after the last one', () => {
    expect(addInterval([]).map((x) => [x.from, x.to])).toEqual([['09:00', '17:00']]);
    const next = addInterval([iv('a', '09:00', '12:00')]);
    expect(next.at(-1)).toMatchObject({ from: '13:00', to: '15:00' });
    // The new row never creates a problem on its own.
    expect(dayProblems(next).size).toBe(0);
  });

  it('stops at the most rows a day may have', () => {
    let list: Interval[] = [];
    for (let i = 0; i < MAX_INTERVALS_PER_DAY + 3; i++) list = addInterval(list);
    expect(list).toHaveLength(MAX_INTERVALS_PER_DAY);
  });

  it('keeps a late row inside the day', () => {
    const next = addInterval([iv('a', '20:00', '23:00')]);
    expect(next.at(-1)!.from <= '23:59').toBe(true);
    expect(next.at(-1)!.to <= '23:59').toBe(true);
    expect(next.at(-1)!.from < next.at(-1)!.to).toBe(true);
  });

  it('copies a day onto others with new row ids', () => {
    const w = defaultWeek();
    w[1] = [iv('m1', '08:00', '12:00'), iv('m2', '13:00', '17:00')];
    const next = copyDay(w, 1, [2, 6, 1]);
    expect(next[2].map((x) => [x.from, x.to])).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(next[6]).toHaveLength(2);
    expect(next[2][0]!.id).not.toBe('m1');
    expect(next[3]).toBe(w[3]);
  });

  it('adds up the time of a day', () => {
    expect(
      dayMinutes([iv('a', '09:00', '12:30'), iv('b', '14:00', '15:00'), iv('c', '16:00', '')]),
    ).toBe(270);
  });
});

describe('date overrides', () => {
  it('converts to and from the API shape, sorted by date', () => {
    const list = overridesFromWire([
      { date: '2026-12-25', closed: true, from: null, to: null, reason: 'Christmas' },
      { date: '2026-10-10', closed: false, from: '10:00:00', to: '14:00:00', reason: null },
      { date: 'nonsense', closed: true, from: null, to: null, reason: null },
    ]);
    expect(list.map((o) => o.date)).toEqual(['2026-10-10', '2026-12-25']);
    expect(list[0]).toMatchObject({ closed: false, from: '10:00', to: '14:00', reason: '' });
    expect(overridesToWire(list)).toEqual([
      { date: '2026-10-10', closed: false, from: '10:00', to: '14:00', reason: null },
      { date: '2026-12-25', closed: true, from: null, to: null, reason: 'Christmas' },
    ]);
  });

  it('closes a day once and un-closes it on a second click', () => {
    let list = addClosedDay([], '2026-12-25', 'Christmas');
    list = addClosedDay(list, '2026-12-25');
    expect(list).toHaveLength(1);
    expect(toggleClosedDay(list, '2026-12-25')).toEqual([]);
    expect(toggleClosedDay(list, '2026-12-26')).toHaveLength(2);
    expect(addClosedDay(list, 'bad-date')).toHaveLength(1);
  });

  it('closes a run of days and leaves existing overrides alone', () => {
    let list = overridesFromWire([
      { date: '2026-12-26', closed: false, from: '10:00', to: '12:00', reason: null },
    ]);
    list = addClosedRange(list, '2026-12-24', '2026-12-27', 'Holiday');
    expect(list.map((o) => [o.date, o.closed])).toEqual([
      ['2026-12-24', true],
      ['2026-12-25', true],
      ['2026-12-26', false],
      ['2026-12-27', true],
    ]);
    expect(addClosedRange(list, '2026-12-30', '2026-12-28')).toHaveLength(4);
  });

  it('wants an open override to have an ordered start and end', () => {
    const list = overridesFromWire([
      { date: '2026-10-10', closed: false, from: '10:00', to: null, reason: null },
      { date: '2026-10-11', closed: false, from: '14:00', to: '13:00', reason: null },
      { date: '2026-10-12', closed: true, from: null, to: null, reason: null },
      { date: '2026-10-13', closed: false, from: '09:00', to: '10:00', reason: null },
    ]);
    const p = overrideProblems(list);
    expect(p.get(list[0]!.id)).toBe('incomplete');
    expect(p.get(list[1]!.id)).toBe('order');
    expect(p.has(list[2]!.id)).toBe(false);
    expect(p.has(list[3]!.id)).toBe(false);
  });

  it('tells how a date is bookable', () => {
    const week = defaultWeek();
    const overrides = overridesFromWire([
      { date: '2026-10-07', closed: true, from: null, to: null, reason: null },
      { date: '2026-10-10', closed: false, from: '10:00', to: '12:00', reason: null },
    ]);
    expect(dateStatus('2026-10-06', week, overrides)).toBe('open');
    expect(dateStatus('2026-10-07', week, overrides)).toBe('closed');
    expect(dateStatus('2026-10-10', week, overrides)).toBe('custom');
    expect(dateStatus('2026-10-11', week, overrides)).toBe('off');
  });
});

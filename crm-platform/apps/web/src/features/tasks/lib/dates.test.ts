import { describe, expect, it } from 'vitest';
import type { TaskResponse } from '@crm/contracts';
import {
  bucketOf,
  compareByDue,
  dayKey,
  fromLocalInput,
  groupByBucket,
  isOverdue,
  presetDue,
  relativeDay,
  toLocalInput,
} from './dates';

const NOW = new Date('2026-10-02T10:00:00Z');
const UTC = 'UTC';

describe('bucketOf (WD-TASK-009)', () => {
  it('puts a due time that has passed in overdue, even earlier the same day', () => {
    expect(bucketOf('2026-10-02T09:00:00Z', 'open', NOW, UTC)).toBe('overdue');
    expect(bucketOf('2026-10-01T23:00:00Z', 'open', NOW, UTC)).toBe('overdue');
  });
  it('puts a later time today in today and a later day in upcoming', () => {
    expect(bucketOf('2026-10-02T15:00:00Z', 'open', NOW, UTC)).toBe('today');
    expect(bucketOf('2026-10-03T00:00:00Z', 'open', NOW, UTC)).toBe('upcoming');
  });
  it('has no bucket for a done task and "no_date" for an undated open one', () => {
    expect(bucketOf('2026-10-01T09:00:00Z', 'done', NOW, UTC)).toBeNull();
    expect(bucketOf(null, 'open', NOW, UTC)).toBe('no_date');
  });
  it('cuts the day in the given zone, not in UTC', () => {
    // 23:30 UTC on the 2nd is already the 3rd in Tokyo
    const late = new Date('2026-10-02T23:30:00Z');
    expect(bucketOf('2026-10-03T05:00:00Z', 'open', late, 'Asia/Tokyo')).toBe('today');
    expect(bucketOf('2026-10-03T05:00:00Z', 'open', late, UTC)).toBe('upcoming');
  });
  it('treats an unparseable date as no date', () => {
    expect(bucketOf('nonsense', 'open', NOW, UTC)).toBe('no_date');
  });
});

describe('isOverdue', () => {
  it('is only true for open tasks past due', () => {
    expect(isOverdue({ status: 'open', dueAt: '2026-10-02T09:59:00Z' }, NOW, UTC)).toBe(true);
    expect(isOverdue({ status: 'done', dueAt: '2026-10-02T09:59:00Z' }, NOW, UTC)).toBe(false);
    expect(isOverdue({ status: 'open', dueAt: null }, NOW, UTC)).toBe(false);
  });
});

describe('ordering and grouping', () => {
  const task = (title: string, dueAt: string | null, status: 'open' | 'done' = 'open') =>
    ({ title, dueAt, status }) as TaskResponse;

  it('sorts soonest first with undated last', () => {
    const list = [
      task('c', null),
      task('b', '2026-10-05T00:00:00Z'),
      task('a', '2026-10-03T00:00:00Z'),
    ];
    expect(list.sort(compareByDue).map((t) => t.title)).toEqual(['a', 'b', 'c']);
  });

  it('groups the open tasks into the four buckets and drops done ones', () => {
    const g = groupByBucket(
      [
        task('late', '2026-10-01T10:00:00Z'),
        task('now', '2026-10-02T16:00:00Z'),
        task('next', '2026-10-09T10:00:00Z'),
        task('whenever', null),
        task('finished', '2026-10-01T10:00:00Z', 'done'),
      ],
      NOW,
      UTC,
    );
    expect(g.overdue.map((t) => t.title)).toEqual(['late']);
    expect(g.today.map((t) => t.title)).toEqual(['now']);
    expect(g.upcoming.map((t) => t.title)).toEqual(['next']);
    expect(g.no_date.map((t) => t.title)).toEqual(['whenever']);
  });
});

describe('date inputs', () => {
  it('round-trips a local value through an instant with an offset', () => {
    const iso = fromLocalInput('2026-10-05T14:30');
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/Z$/);
    expect(toLocalInput(iso)).toBe('2026-10-05T14:30');
  });
  it('maps empty and invalid input to null / empty', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('garbage')).toBe('');
  });
});

describe('presetDue', () => {
  it('today is 17:00, or the next full hour once that has passed', () => {
    const morning = new Date(2026, 9, 2, 10, 15);
    const a = new Date(presetDue('today', morning));
    expect([a.getDate(), a.getHours(), a.getMinutes()]).toEqual([2, 17, 0]);
    const evening = new Date(2026, 9, 2, 18, 20);
    const b = new Date(presetDue('today', evening));
    expect(b.getTime()).toBeGreaterThan(evening.getTime());
    expect([b.getHours(), b.getMinutes()]).toEqual([19, 0]);
  });
  it('tomorrow is 17:00 the next day and next week is the coming Monday 09:00', () => {
    const friday = new Date(2026, 9, 2, 10, 0); // 2026-10-02 is a Friday
    const t = new Date(presetDue('tomorrow', friday));
    expect([t.getDate(), t.getHours()]).toEqual([3, 17]);
    const n = new Date(presetDue('nextWeek', friday));
    expect([n.getDay(), n.getDate(), n.getHours()]).toEqual([1, 5, 9]);
    const monday = new Date(2026, 9, 5, 10, 0);
    expect(new Date(presetDue('nextWeek', monday)).getDate()).toBe(12);
  });
});

describe('relativeDay and dayKey', () => {
  it('names yesterday, today and tomorrow by calendar day', () => {
    expect(relativeDay('2026-10-01T20:00:00Z', NOW, UTC)).toBe('yesterday');
    expect(relativeDay('2026-10-02T23:00:00Z', NOW, UTC)).toBe('today');
    expect(relativeDay('2026-10-03T01:00:00Z', NOW, UTC)).toBe('tomorrow');
    expect(relativeDay('2026-10-09T01:00:00Z', NOW, UTC)).toBe('date');
  });
  it('formats a day key in a zone', () => {
    expect(dayKey(NOW, UTC)).toBe('2026-10-02');
  });
});

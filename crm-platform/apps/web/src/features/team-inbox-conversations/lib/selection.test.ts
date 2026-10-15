import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  allInViewSelected,
  failedIds,
  pruneSelection,
  rangeIds,
  selectAllInView,
  selectRange,
  snoozeUntil,
  summarize,
  toggleId,
} from './selection';

const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

describe('selection', () => {
  it('a click toggles one id without touching the others', () => {
    const one = toggleId(EMPTY_SELECTION, 'b');
    expect([...one]).toEqual(['b']);
    expect([...toggleId(one, 'd')]).toEqual(['b', 'd']);
    expect(toggleId(one, 'b').size).toBe(0);
    expect(EMPTY_SELECTION.size).toBe(0);
  });

  it('a shift-click selects the run between the anchor and the row, in either direction', () => {
    expect(rangeIds(rows, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(rows, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(rows, null, 'c')).toEqual(['c']);
    expect(rangeIds(rows, 'gone', 'c')).toEqual(['c']);
    expect(rangeIds(rows, 'a', 'gone')).toEqual([]);
    expect([...selectRange(new Set(['e']), rows, 'a', 'b')].sort()).toEqual(['a', 'b', 'e']);
  });

  it('select all in view takes every loaded row and knows when it has', () => {
    const all = selectAllInView(rows);
    expect(all.size).toBe(5);
    expect(allInViewSelected(rows, all)).toBe(true);
    expect(allInViewSelected(rows, toggleId(all, 'c'))).toBe(false);
    expect(allInViewSelected([], EMPTY_SELECTION)).toBe(false);
  });

  it('drops ids that left the list and keeps the same set when nothing left', () => {
    const sel = new Set(['a', 'x']);
    expect([...pruneSelection(sel, rows)]).toEqual(['a']);
    const same = new Set(['a']);
    expect(pruneSelection(same, rows)).toBe(same);
  });

  it('keeps the failed ones selected and summarizes the outcome', () => {
    const results = [
      { id: 'a', outcome: 'done' as const },
      { id: 'b', outcome: 'failed' as const, code: 'CONVERSATION_NOT_FOUND' },
      { id: 'c', outcome: 'unchanged' as const },
    ];
    expect([...failedIds(results)]).toEqual(['b']);
    expect(summarize({ requested: 3, done: 1, unchanged: 1, failed: 1 })).toBe('partial');
    expect(summarize({ requested: 2, done: 2, unchanged: 0, failed: 0 })).toBe('allDone');
    expect(summarize({ requested: 2, done: 0, unchanged: 2, failed: 0 })).toBe('nothingChanged');
    expect(summarize({ requested: 2, done: 0, unchanged: 0, failed: 2 })).toBe('allFailed');
  });
});

describe('snoozeUntil', () => {
  const now = new Date(2026, 9, 14, 15, 30); // Wednesday 14 October 2026, local time
  it('adds hours exactly', () => {
    expect(Date.parse(snoozeUntil('oneHour', now)) - now.getTime()).toBe(3_600_000);
    expect(Date.parse(snoozeUntil('threeHours', now)) - now.getTime()).toBe(10_800_000);
  });
  it('tomorrow is 09:00 the next day', () => {
    const at = new Date(snoozeUntil('tomorrow', now));
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([15, 9, 0]);
  });
  it('next week is the coming Monday at 09:00, and a Monday asks for the next one', () => {
    const wed = new Date(snoozeUntil('nextWeek', now));
    expect([wed.getDay(), wed.getDate(), wed.getHours()]).toEqual([1, 19, 9]);
    const monday = new Date(snoozeUntil('nextWeek', new Date(2026, 9, 19, 8, 0)));
    expect([monday.getDay(), monday.getDate()]).toEqual([1, 26]);
  });
});

describe('snoozeUntil in a named time zone', () => {
  // 15:30 on Wednesday 14 Oct 2026 in Kolkata (UTC+05:30) is 10:00 UTC.
  const now = new Date('2026-10-14T10:00:00Z');
  it("tomorrow is 09:00 on that zone's calendar, whatever the browser zone is", () => {
    expect(snoozeUntil('tomorrow', now, 'Asia/Kolkata')).toBe('2026-10-15T03:30:00.000Z');
    expect(snoozeUntil('tomorrow', now, 'UTC')).toBe('2026-10-15T09:00:00.000Z');
  });
  it("uses the zone's date when it is already tomorrow there", () => {
    // 22:00 UTC on the 14th is 03:30 on the 15th in Kolkata, so "tomorrow" is the 16th there.
    const late = new Date('2026-10-14T22:00:00Z');
    expect(snoozeUntil('tomorrow', late, 'Asia/Kolkata')).toBe('2026-10-16T03:30:00.000Z');
    expect(snoozeUntil('tomorrow', late, 'UTC')).toBe('2026-10-15T09:00:00.000Z');
  });
  it('next week is the coming Monday 09:00 there, and a Monday asks for the next one', () => {
    expect(snoozeUntil('nextWeek', now, 'Asia/Kolkata')).toBe('2026-10-19T03:30:00.000Z');
    const monday = new Date('2026-10-19T03:00:00Z'); // 08:30 Monday in Kolkata
    expect(snoozeUntil('nextWeek', monday, 'Asia/Kolkata')).toBe('2026-10-26T03:30:00.000Z');
  });
  it('keeps 09:00 across a daylight-saving change', () => {
    // New York ends daylight time on 1 Nov 2026: 09:00 EDT is 13:00Z, 09:00 EST is 14:00Z.
    expect(snoozeUntil('tomorrow', new Date('2026-10-31T15:00:00Z'), 'America/New_York')).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });
});

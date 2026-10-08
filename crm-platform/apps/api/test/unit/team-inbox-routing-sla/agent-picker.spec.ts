import { describe, expect, it } from 'vitest';
import {
  pickLeastBusy,
  pickRoundRobin,
} from '../../../src/modules/team-inbox-routing-sla/agent-picker';

describe('pickRoundRobin', () => {
  it('starts with the lowest id when nobody has had a turn', () => {
    expect(pickRoundRobin([9, 4, 7], null)).toBe(4);
  });

  it('goes around in id order and wraps to the first', () => {
    const pool = [4, 7, 9];
    let cursor: number | null = null;
    const turns: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      cursor = pickRoundRobin(pool, cursor);
      turns.push(cursor!);
    }
    expect(turns).toEqual([4, 7, 9, 4, 7, 9, 4]);
  });

  it('skips people who are not in the pool (suspended, offline) without repeating anyone', () => {
    // 7 is unavailable now: the turn after 4 goes to 9, then back to 4.
    expect(pickRoundRobin([4, 9], 4)).toBe(9);
    expect(pickRoundRobin([4, 9], 9)).toBe(4);
  });

  it('keeps its place when the person who had the last turn is gone', () => {
    // the cursor (7) left; the next id after it is 9, not a restart from 4
    expect(pickRoundRobin([4, 9, 12], 7)).toBe(9);
  });

  it('wraps when the cursor is past everyone, and returns null for an empty pool', () => {
    expect(pickRoundRobin([4, 9], 20)).toBe(4);
    expect(pickRoundRobin([], 4)).toBeNull();
  });

  it('a pool of one always picks that person', () => {
    expect(pickRoundRobin([5], 5)).toBe(5);
    expect(pickRoundRobin([5, 5], null)).toBe(5);
  });
});

describe('pickLeastBusy', () => {
  it('picks the fewest open conversations', () => {
    expect(
      pickLeastBusy(
        [
          { userId: 1, open: 3 },
          { userId: 2, open: 1 },
          { userId: 3, open: 2 },
        ],
        null,
      ),
    ).toBe(2);
  });

  it('breaks a tie by the rotation so equal people take turns', () => {
    const pool = [
      { userId: 1, open: 2 },
      { userId: 2, open: 2 },
      { userId: 3, open: 5 },
    ];
    expect(pickLeastBusy(pool, null)).toBe(1);
    expect(pickLeastBusy(pool, 1)).toBe(2);
    expect(pickLeastBusy(pool, 2)).toBe(1);
  });

  it('is null when nobody is available', () => {
    expect(pickLeastBusy([], null)).toBeNull();
  });
});

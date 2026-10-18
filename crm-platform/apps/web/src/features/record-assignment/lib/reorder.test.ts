import { describe, expect, it } from 'vitest';
import type { AssignmentRule } from '@crm/contracts';
import { moveItem, reorderIds, ruleGroup, sortRules } from './reorder';

const rule = (id: string, position: number, over: Partial<AssignmentRule> = {}) =>
  ({ id, position, isActive: true, isFallback: false, ...over }) as AssignmentRule;

describe('sortRules', () => {
  it('lists active rules by place, then the fallbacks, then the paused rules', () => {
    const sorted = sortRules([
      rule('paused', 1, { isActive: false }),
      rule('fallback', 2, { isFallback: true }),
      rule('b', 4),
      rule('a', 3),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'fallback', 'paused']);
    expect(sorted.map(ruleGroup)).toEqual(['conditional', 'conditional', 'fallback', 'paused']);
  });
});

describe('moveItem', () => {
  it('moves, clamps and leaves an unknown place alone', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('reorderIds', () => {
  const sorted = sortRules([
    rule('a', 1),
    rule('b', 2),
    rule('c', 3),
    rule('f', 4, { isFallback: true }),
    rule('p', 5, { isActive: false }),
  ]);
  it('moves one step with the arrows and sends the whole list', () => {
    expect(reorderIds(sorted, 'b', { step: -1 })).toEqual(['b', 'a', 'c', 'f', 'p']);
    expect(reorderIds(sorted, 'b', { step: 1 })).toEqual(['a', 'c', 'b', 'f', 'p']);
  });
  it('moves onto the place of another rule when dropped', () => {
    expect(reorderIds(sorted, 'a', { overId: 'c' })).toEqual(['b', 'c', 'a', 'f', 'p']);
  });
  it('does not cross into another group, off the ends or onto itself', () => {
    expect(reorderIds(sorted, 'c', { step: 1 })).toBeNull(); // the fallback runs last whatever
    expect(reorderIds(sorted, 'p', { step: -1 })).toBeNull();
    expect(reorderIds(sorted, 'a', { step: -1 })).toBeNull();
    expect(reorderIds(sorted, 'a', { overId: 'a' })).toBeNull();
    expect(reorderIds(sorted, 'nope', { step: 1 })).toBeNull();
  });
});

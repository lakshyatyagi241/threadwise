import { describe, expect, it } from 'vitest';
import type { Stage } from '../api/schemas';
import {
  insertionIndex,
  moveStage,
  needsReassign,
  probabilityFor,
  reassignTargets,
  validateStage,
} from './stage-editor';

const stages = [
  { id: 'a', kind: 'open' },
  { id: 'b', kind: 'open' },
  { id: 'w', kind: 'won' },
  { id: 'l', kind: 'lost' },
] as const;

const input = { name: 'Contract', color: '#16A34A', probability: 60, kind: 'open' as const };

describe('stage editor', () => {
  it('fixes the probability of won and lost stages', () => {
    expect(probabilityFor('won', 12)).toBe(100);
    expect(probabilityFor('lost', 80)).toBe(0);
    expect(probabilityFor('open', 140)).toBe(100);
    expect(probabilityFor('open', -4)).toBe(0);
    expect(probabilityFor('open', 33.6)).toBe(34);
    expect(probabilityFor('open', Number.NaN)).toBe(0);
  });

  it('accepts a good stage and names every problem of a bad one', () => {
    expect(validateStage(input, stages)).toEqual([]);
    expect(validateStage({ ...input, name: '  ' }, stages)).toContain('nameRequired');
    expect(validateStage({ ...input, name: 'x'.repeat(121) }, stages)).toContain('nameTooLong');
    expect(validateStage({ ...input, probability: 101 }, stages)).toContain('probability');
    expect(validateStage({ ...input, probability: 10.5 }, stages)).toContain('probability');
    expect(validateStage({ ...input, color: 'green' }, stages)).toContain('color');
  });

  it('allows one won and one lost stage', () => {
    expect(validateStage({ ...input, kind: 'won', probability: 100 }, stages)).toContain('twoWon');
    expect(validateStage({ ...input, kind: 'lost', probability: 0 }, stages)).toContain('twoLost');
    // editing the existing won stage is not a second one
    expect(validateStage({ ...input, kind: 'won', probability: 100 }, stages, 'w')).toEqual([]);
  });

  it('moves a stage without touching the original array', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(moveStage(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveStage(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveStage(ids, 1, 1)).toEqual(ids);
    expect(moveStage(ids, 1, 9)).toEqual(ids);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inserts open stages before the closing ones', () => {
    expect(insertionIndex(stages, 'open')).toBe(2);
    expect(insertionIndex(stages, 'won')).toBe(4);
    expect(insertionIndex([{ kind: 'open' }, { kind: 'open' }], 'open')).toBe(2);
    expect(insertionIndex([], 'open')).toBe(0);
  });

  it('asks where deals go only when some are in the stage', () => {
    expect(needsReassign({ dealCount: 0 })).toBe(false);
    expect(needsReassign({ dealCount: 3 })).toBe(true);
    const list = stages.map((s) => ({ id: s.id })) as Pick<Stage, 'id'>[];
    expect(reassignTargets(list, 'b').map((s) => s.id)).toEqual(['a', 'w', 'l']);
  });
});

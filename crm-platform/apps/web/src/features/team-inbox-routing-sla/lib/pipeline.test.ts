import { describe, expect, it } from 'vitest';
import {
  everyoneElseMode,
  everyoneElseOf,
  isCatchAll,
  movedIds,
  neverMatches,
  pipelineRules,
  shadowedIds,
  shadowedRules,
} from './pipeline';
import { U1, rule } from './fixtures';

const every = (id: string, over: Parameters<typeof rule>[0] = {}) =>
  rule({ id, name: `Rule ${id}`, appliesToAll: true, ...over });
const conditional = (id: string) => rule({ id, name: `Rule ${id}` });

describe('the pipeline', () => {
  it('keeps Everyone else out of the list and finds it', () => {
    const ee = rule({ id: 'ee', isFallback: true, appliesToAll: true });
    const rules = [conditional('a'), ee, conditional('b')];
    expect(pipelineRules(rules).map((r) => r.id)).toEqual(['a', 'b']);
    expect(everyoneElseOf(rules)?.id).toBe('ee');
    expect(everyoneElseOf([conditional('a')])).toBeUndefined();
  });

  it('Everyone else is queue (no row, or off), evenly, or listed agents', () => {
    expect(everyoneElseMode(undefined)).toBe('queue');
    expect(everyoneElseMode(rule({ isFallback: true, isActive: false }))).toBe('queue');
    expect(
      everyoneElseMode(
        rule({
          isFallback: true,
          assign: { strategy: 'round_robin', userIds: [], teamIds: [], everyone: true },
        }),
      ),
    ).toBe('evenly');
    expect(
      everyoneElseMode(
        rule({
          isFallback: true,
          assign: { strategy: 'round_robin', userIds: [U1], teamIds: [], everyone: false },
        }),
      ),
    ).toBe('listed');
  });

  it('a catch-all is a rule that applies to every conversation, never the fallback', () => {
    expect(isCatchAll(every('a'))).toBe(true);
    expect(isCatchAll(every('a', { isFallback: true }))).toBe(false);
    expect(isCatchAll(conditional('a'))).toBe(false);
  });

  it('a rule with no condition and no switch never matches', () => {
    const bare = rule({
      conditions: { ...rule().conditions, channelKinds: [], keywords: null },
    });
    expect(neverMatches(bare)).toBe(true);
    expect(neverMatches(rule({ ...bare, appliesToAll: true }))).toBe(false);
    expect(neverMatches(rule())).toBe(false);
  });
});

describe('a catch-all above other rules', () => {
  it('stops every active rule below it, and names which', () => {
    const rules = [conditional('a'), every('all'), conditional('b'), conditional('c')];
    const out = shadowedRules(rules);
    expect(out).toHaveLength(1);
    expect(out[0]!.blocker.id).toBe('all');
    expect(out[0]!.blocked.map((r) => r.id)).toEqual(['b', 'c']);
    expect([...shadowedIds(rules)].sort()).toEqual(['b', 'c']);
  });

  it('is silent when the catch-all is last, switched off, or keeps checking', () => {
    expect(shadowedRules([conditional('a'), every('all')])).toEqual([]);
    expect(shadowedRules([every('all', { isActive: false }), conditional('b')])).toEqual([]);
    expect(shadowedRules([every('all', { stopOnMatch: false }), conditional('b')])).toEqual([]);
  });

  it('does not warn about rules that are switched off', () => {
    const rules = [every('all'), rule({ id: 'b', isActive: false })];
    expect(shadowedRules(rules)).toEqual([]);
  });
});

describe('reordering', () => {
  it('moves one id and ignores impossible moves', () => {
    expect(movedIds(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movedIds(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movedIds(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(movedIds(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

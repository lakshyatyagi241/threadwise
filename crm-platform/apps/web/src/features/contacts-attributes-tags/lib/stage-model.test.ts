import { describe, expect, it } from 'vitest';
import type { StatusOptionResponse } from '@crm/contracts';
import {
  checkLabel,
  deleteNeeds,
  groupOptions,
  isHexColor,
  moveItem,
  moveTargets,
  optionColor,
  sameOrder,
  stageColor,
  stageSeeds,
  statusSeeds,
  valueFromLabel,
} from './stage-model';

const opt = (over: Partial<StatusOptionResponse>): StatusOptionResponse => ({
  id: 'a',
  moduleKey: 'contacts',
  optionGroup: 'lifecycle_stage',
  value: 'new',
  label: 'New',
  color: null,
  position: 0,
  isDefault: false,
  isActive: true,
  isWon: false,
  isLost: false,
  stageOptionId: null,
  rowVersion: 1,
  ...over,
});

describe('colours', () => {
  it('accepts only #rrggbb', () => {
    expect(isHexColor('#0284c7')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it('draws an option in its own colour, else the stable colour of its value', () => {
    expect(optionColor({ value: 'new', color: '#112233' })).toBe('#112233');
    expect(optionColor({ value: 'new', color: 'nonsense' })).toBe(stageColor('new'));
    expect(optionColor({ value: 'vip_club', color: null })).toBe(stageColor('vip_club'));
    expect(stageColor('vip_club')).toBe(stageColor('vip_club'));
  });
});

describe('groupOptions', () => {
  it('keeps the options of a group, in saved order, and folds in the status alias', () => {
    const all = [
      opt({ id: 'c', optionGroup: 'status', value: 'vip', position: 1 }),
      opt({ id: 'b', optionGroup: 'lifecycle_stage', value: 'x', position: 1 }),
      opt({ id: 'a', optionGroup: 'lifecycle_stage', value: 'y', position: 0 }),
      opt({ id: 'd', optionGroup: 'contact_status', value: 'prospect', position: 0 }),
      opt({ id: 'e', optionGroup: 'deal_status', value: 'won' }),
    ];
    expect(groupOptions(all, 'lifecycle_stage').map((o) => o.id)).toEqual(['a', 'b']);
    expect(groupOptions(all, 'status').map((o) => o.id)).toEqual(['d', 'c']);
    expect(groupOptions(undefined, 'status')).toEqual([]);
  });
});

describe('checkLabel', () => {
  const others = [{ id: '1', label: 'Qualified' }];
  it('requires a label that fits and is not already used (ignoring case)', () => {
    expect(checkLabel('  ', others)).toBe('required');
    expect(checkLabel('x'.repeat(256), others)).toBe('tooLong');
    expect(checkLabel('qualified', others)).toBe('taken');
    expect(checkLabel('Qualified', others, '1')).toBeNull();
    expect(checkLabel('Won', others)).toBeNull();
  });
});

describe('valueFromLabel', () => {
  it('makes a snake_case key and keeps it unique in the group', () => {
    expect(valueFromLabel('Interview scheduled', [])).toBe('interview_scheduled');
    expect(valueFromLabel('Won', ['won'])).toBe('won_2');
    expect(valueFromLabel('Won', ['won', 'won_2'])).toBe('won_3');
  });

  it('falls back when the label has no Latin letters or starts with digits only', () => {
    expect(valueFromLabel('عميل', [], 'stage')).toBe('stage');
    expect(valueFromLabel('123', [])).toBe('option');
  });
});

describe('moveItem', () => {
  it('moves one item and clamps the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -3)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a'], 5, 0)).toEqual(['a']);
  });

  it('does not touch the original', () => {
    const list = ['a', 'b'];
    moveItem(list, 0, 1);
    expect(list).toEqual(['a', 'b']);
  });

  it('sameOrder compares element by element', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('seeds and delete rules', () => {
  it('offers the ten platform stages with "new" as the default', () => {
    const seeds = stageSeeds();
    expect(seeds).toHaveLength(10);
    expect(seeds.filter((s) => s.isDefault).map((s) => s.value)).toEqual(['new']);
    expect(seeds[3]!.label).toBe('Application Started');
    expect(seeds.every((s) => isHexColor(s.color))).toBe(true);
  });

  it("offers the four platform statuses with the caller's labels", () => {
    const seeds = statusSeeds((v) => v.toUpperCase());
    expect(seeds.map((s) => s.label)).toEqual(['ACTIVE', 'PROSPECT', 'CUSTOMER', 'VIP']);
    expect(seeds.every((s) => !s.isDefault)).toBe(true);
  });

  it('a delete needs a move target only when contacts hold the option', () => {
    expect(deleteNeeds(0)).toBe('nothing');
    expect(deleteNeeds(3)).toBe('move');
    expect(moveTargets([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
  });
});

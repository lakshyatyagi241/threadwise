import { describe, expect, it } from 'vitest';
import {
  expandOptionPairGroups,
  fieldOptionDependencyGroupsResponseSchema,
  fieldOptionDependencyResponseSchema,
} from './field-metadata';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('grouped option pairs', () => {
  const groups = [
    {
      parentFieldId: u(1),
      parentOptionId: u(10),
      childFieldId: u(2),
      childOptionIds: [u(20), u(21)],
    },
    { parentFieldId: u(1), parentOptionId: u(11), childFieldId: u(2), childOptionIds: [u(22)] },
    // a second cascade off the same parent option: another child field
    { parentFieldId: u(1), parentOptionId: u(10), childFieldId: u(3), childOptionIds: [u(30)] },
  ];

  it('the grouped response validates, and an empty list is fine', () => {
    expect(fieldOptionDependencyGroupsResponseSchema.parse(groups)).toHaveLength(3);
    expect(fieldOptionDependencyGroupsResponseSchema.parse([])).toEqual([]);
  });

  it('a group with a malformed uuid is rejected', () => {
    expect(() =>
      fieldOptionDependencyGroupsResponseSchema.parse([{ ...groups[0], childOptionIds: ['nope'] }]),
    ).toThrow();
  });

  it('expands to one flat pair per child option, with the four ids the callers read', () => {
    const flat = expandOptionPairGroups(groups);
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => [p.parentOptionId, p.childFieldId, p.childOptionId])).toEqual([
      [u(10), u(2), u(20)],
      [u(10), u(2), u(21)],
      [u(11), u(2), u(22)],
      [u(10), u(3), u(30)],
    ]);
    expect(flat.every((p) => p.parentFieldId === u(1))).toBe(true);
  });

  it('each expanded pair has a distinct id of its own and the response type of the flat list', () => {
    const flat = expandOptionPairGroups(groups);
    expect(new Set(flat.map((p) => p.id)).size).toBe(flat.length);
    // same keys as the flat response, so code written for the flat list takes it unchanged
    expect(Object.keys(flat[0]!).sort()).toEqual(
      Object.keys(fieldOptionDependencyResponseSchema.shape).sort(),
    );
  });

  it('expanding nothing gives nothing', () => {
    expect(expandOptionPairGroups([])).toEqual([]);
    expect(expandOptionPairGroups([{ ...groups[0]!, childOptionIds: [] }])).toEqual([]);
  });
});

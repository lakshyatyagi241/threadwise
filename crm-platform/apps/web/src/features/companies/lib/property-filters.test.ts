import { describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import {
  completeCount,
  conditionsFromProps,
  filterableFields,
  isSortableKind,
  propsFromConditions,
} from './property-filters';

const field = (over: Partial<FieldResponse>): FieldResponse =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    moduleKey: 'companies',
    sectionId: null,
    key: 'tier',
    label: 'Tier',
    fieldType: 'select',
    isRequired: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    isUnique: false,
    isQuickCreate: false,
    isGlobalSearch: false,
    isSystem: false,
    isActive: true,
    position: 0,
    config: {},
    replacesFieldId: null,
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
    ],
    rowVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }) as FieldResponse;

const fields = [
  field({}),
  field({ key: 'seats', label: 'Seats', fieldType: 'integer', options: undefined }),
  field({ key: 'channels', label: 'Channels', fieldType: 'multiselect' }),
  field({ key: 'secret', label: 'Secret', fieldType: 'text', isMasked: true }),
  field({ key: 'hidden', label: 'Hidden', fieldType: 'text', isHidden: true }),
  field({ key: 'old', label: 'Old', fieldType: 'text', isActive: false }),
  field({ key: 'calc', label: 'Calc', fieldType: 'formula' }),
  field({ key: 'sys', label: 'Sys', fieldType: 'text', isSystem: true }),
];

describe('filterableFields (BL-196)', () => {
  it('offers the active, visible, stored, unmasked properties, with the options of an option kind', () => {
    const out = filterableFields(fields);
    expect(out.map((f) => f.id)).toEqual(['tier', 'seats', 'channels']);
    expect(out[0]).toMatchObject({
      kind: 'option',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
    });
    expect(out[1]).toMatchObject({ kind: 'number' });
    expect(out[1]?.options).toBeUndefined();
  });

  it('only some kinds can order a list', () => {
    const kinds = filterableFields(fields).map((f) => [f.id, isSortableKind(f.kind)]);
    expect(kinds).toEqual([
      ['tier', true],
      ['seats', true],
      ['channels', false],
    ]);
  });
});

describe('the conditions of the address and the editor (BL-196)', () => {
  const catalog = filterableFields(fields);

  it('round-trips a list of conditions', () => {
    const props = [
      { key: 'tier', operator: 'in' as const, value: ['gold', 'silver'] },
      { key: 'seats', operator: 'between' as const, value: { from: 10, to: 50 } },
      { key: 'seats', operator: 'is_empty' as const },
    ];
    const root = conditionsFromProps(props, catalog);
    expect(propsFromConditions(root, catalog)).toEqual(props);
    expect(completeCount(root, catalog)).toBe(3);
  });

  it('leaves out a condition on a property that is gone, and a half-filled row', () => {
    const root = conditionsFromProps(
      [
        { key: 'ghost', operator: 'equals', value: 'x' },
        { key: 'tier', operator: 'equals', value: '' as never },
      ],
      catalog,
    );
    expect(root.children).toHaveLength(1);
    expect(completeCount(root, catalog)).toBe(0);
    expect(propsFromConditions(root, catalog)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type {
  FieldDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
  FieldSectionResponse,
} from '@crm/contracts';
import {
  BUILT_IN_PROPERTIES,
  CREATABLE_TYPES,
  checkDraft,
  configFromDraft,
  dependentsOf,
  describeCondition,
  detailGroups,
  diffConditions,
  diffOptions,
  draftFromField,
  emptyDraft,
  groupBySection,
  hasProblems,
  isOptionType,
  matchesSearch,
  moveRelative,
  newOptionValue,
  toCreateBody,
  toUpdateBody,
} from './property-model';

const section = (id: string, position: number, name = id): FieldSectionResponse => ({
  id,
  moduleKey: 'contacts',
  name,
  position,
  isActive: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const field = (over: Partial<FieldResponse> & { id: string }): FieldResponse => ({
  moduleKey: 'contacts',
  sectionId: 's1',
  key: over.id,
  label: over.id,
  fieldType: 'text',
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
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const option = (id: string, label: string, position = 0): FieldOptionResponse => ({
  id,
  fieldId: 'f',
  value: id,
  label,
  position,
  isHidden: false,
  rowVersion: 1,
});

describe('types', () => {
  it('offers the property types the owner asked for, and only option types carry options', () => {
    expect(CREATABLE_TYPES).toEqual([
      'text',
      'long_text',
      'integer',
      'decimal',
      'date',
      'select',
      'multiselect',
      'checkbox',
      'url',
      'email',
      'phone',
    ]);
    expect(isOptionType('select')).toBe(true);
    expect(isOptionType('multiselect')).toBe(true);
    expect(isOptionType('text')).toBe(false);
  });

  it('lists the built-in properties once each, with stage and status managed elsewhere', () => {
    const keys = BUILT_IN_PROPERTIES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(BUILT_IN_PROPERTIES.find((p) => p.key === 'lifecycle_stage')?.manage).toBe(
      '/contact-stages',
    );
  });
});

describe('groupBySection', () => {
  it('orders sections and properties, keeps empty sections, and puts sectionless properties last', () => {
    const groups = groupBySection(
      [section('b', 1), section('a', 0), section('empty', 2)],
      [
        field({ id: 'x', sectionId: 'a', position: 1 }),
        field({ id: 'y', sectionId: 'a', position: 0 }),
        field({ id: 'z', sectionId: 'b' }),
        field({ id: 'loose', sectionId: null }),
        field({ id: 'orphan', sectionId: 'deleted-section', position: 3 }),
      ],
    );
    expect(groups.map((g) => g.section?.id ?? null)).toEqual(['a', 'b', 'empty', null]);
    expect(groups[0]!.fields.map((f) => f.id)).toEqual(['y', 'x']);
    expect(groups[2]!.fields).toEqual([]);
    expect(groups[3]!.fields.map((f) => f.id)).toEqual(['loose', 'orphan']);
  });

  it('has no sectionless group when every property has a section', () => {
    expect(groupBySection([section('a', 0)], [field({ id: 'x', sectionId: 'a' })])).toHaveLength(1);
  });
});

describe('matchesSearch', () => {
  const f = field({
    id: 'p',
    key: 'order_id',
    label: 'Order ID',
    config: { description: 'From the shop' },
  });
  it('matches label, key and description, ignoring case', () => {
    expect(matchesSearch(f, '')).toBe(true);
    expect(matchesSearch(f, 'order')).toBe(true);
    expect(matchesSearch(f, 'ORDER_ID')).toBe(true);
    expect(matchesSearch(f, 'shop')).toBe(true);
    expect(matchesSearch(f, 'nothing')).toBe(false);
  });
});

describe('checkDraft', () => {
  const ok = { ...emptyDraft('s1'), label: 'City', key: 'city' };
  const taken = new Set(['existing']);

  it('accepts a complete draft', () => {
    expect(hasProblems(checkDraft(ok, { editing: false, takenKeys: taken }))).toBe(false);
  });

  it('checks the name and the key (create only)', () => {
    expect(checkDraft({ ...ok, label: ' ' }, { editing: false, takenKeys: taken }).label).toBe(
      'required',
    );
    expect(checkDraft({ ...ok, key: '' }, { editing: false, takenKeys: taken }).key).toBe(
      'required',
    );
    expect(checkDraft({ ...ok, key: 'Bad Key' }, { editing: false, takenKeys: taken }).key).toBe(
      'format',
    );
    expect(
      checkDraft({ ...ok, key: 'a'.repeat(65) }, { editing: false, takenKeys: taken }).key,
    ).toBe('tooLong');
    expect(checkDraft({ ...ok, key: 'email' }, { editing: false, takenKeys: taken }).key).toBe(
      'reserved',
    );
    expect(checkDraft({ ...ok, key: 'existing' }, { editing: false, takenKeys: taken }).key).toBe(
      'taken',
    );
    // an existing property's key is never re-checked
    expect(
      checkDraft({ ...ok, key: 'existing' }, { editing: true, takenKeys: taken }).key,
    ).toBeUndefined();
  });

  it('needs a section', () => {
    expect(checkDraft({ ...ok, sectionId: '' }, { editing: false, takenKeys: taken }).section).toBe(
      'required',
    );
  });

  it('a dropdown needs at least one option, each with a distinct label', () => {
    const select = { ...ok, type: 'select' as const };
    const run = (options: Array<{ value: string; label: string }>) =>
      checkDraft({ ...select, options }, { editing: false, takenKeys: taken }).options;
    expect(run([])).toBe('required');
    expect(run([{ value: 'a', label: ' ' }])).toBe('emptyLabel');
    expect(
      run([
        { value: 'a', label: 'Red' },
        { value: 'b', label: 'red' },
      ]),
    ).toBe('duplicate');
    expect(run([{ value: 'a', label: 'Red' }])).toBeUndefined();
    // a text property ignores options
    expect(
      checkDraft({ ...ok, options: [] }, { editing: false, takenKeys: taken }).options,
    ).toBeUndefined();
  });

  it('a condition needs a property and an option or a value', () => {
    const run = (c: { fieldId: string; optionId: string | null; value: string }) =>
      checkDraft({ ...ok, conditions: [c] }, { editing: false, takenKeys: taken }).condition;
    expect(run({ fieldId: '', optionId: null, value: '' })).toBe('incomplete');
    expect(run({ fieldId: 'f', optionId: null, value: ' ' })).toBe('incomplete');
    expect(run({ fieldId: 'f', optionId: 'o', value: '' })).toBeUndefined();
    expect(run({ fieldId: 'f', optionId: null, value: 'true' })).toBeUndefined();
  });
});

describe('request bodies', () => {
  it('builds the create body with options in order, the description in config, and the flags', () => {
    const body = toCreateBody({
      ...emptyDraft('s1'),
      label: ' Country ',
      key: 'country',
      type: 'select',
      description: ' Where they live ',
      required: true,
      visible: false,
      options: [
        { value: 'in', label: 'India' },
        { value: 'ae', label: 'UAE' },
      ],
    });
    expect(body).toMatchObject({
      moduleKey: 'contacts',
      sectionId: 's1',
      key: 'country',
      label: 'Country',
      fieldType: 'select',
      isRequired: true,
      isHidden: true,
      config: { description: 'Where they live' },
      options: [
        { value: 'in', label: 'India', position: 0 },
        { value: 'ae', label: 'UAE', position: 1 },
      ],
    });
  });

  it('leaves options out for a text property', () => {
    expect('options' in toCreateBody({ ...emptyDraft('s1'), label: 'A', key: 'a' })).toBe(false);
  });

  it('keeps the rest of the config when the description changes, and removes it when emptied', () => {
    expect(configFromDraft({ defaultValue: 'x', description: 'old' }, 'new')).toEqual({
      defaultValue: 'x',
      description: 'new',
    });
    expect(configFromDraft({ defaultValue: 'x', description: 'old' }, '  ')).toEqual({
      defaultValue: 'x',
    });
  });

  it('builds the update body from the saved row version, never touching the key or type', () => {
    const f = field({ id: 'p', config: { defaultValue: 'x' }, rowVersion: 7 });
    const body = toUpdateBody({ ...draftFromField(f, []), label: 'Renamed', active: false }, f);
    expect(body).toMatchObject({
      label: 'Renamed',
      isActive: false,
      rowVersion: 7,
      config: { defaultValue: 'x' },
    });
    expect('key' in body).toBe(false);
    expect('fieldType' in body).toBe(false);
  });
});

describe('draftFromField', () => {
  it('reads options in order and only the dependencies of this property', () => {
    const f = field({
      id: 'p',
      fieldType: 'select',
      options: [option('o2', 'B', 1), option('o1', 'A', 0)],
    });
    const deps: FieldDependencyResponse[] = [
      {
        id: 'd1',
        fieldId: 'p',
        dependsOnFieldId: 'q',
        dependsOnOptionId: 'oq',
        dependsOnValue: null,
        createdAt: '',
      },
      {
        id: 'd2',
        fieldId: 'other',
        dependsOnFieldId: 'q',
        dependsOnOptionId: null,
        dependsOnValue: 'x',
        createdAt: '',
      },
    ];
    const d = draftFromField(f, deps);
    expect(d.options.map((o) => o.label)).toEqual(['A', 'B']);
    expect(d.conditions).toEqual([{ id: 'd1', fieldId: 'q', optionId: 'oq', value: '' }]);
  });
});

describe('diffOptions', () => {
  const saved = [option('a', 'Red', 0), option('b', 'Blue', 1), option('c', 'Green', 2)];
  it('finds new, renamed and dropped options', () => {
    const diff = diffOptions(saved, [
      { id: 'a', value: 'a', label: 'Crimson' },
      { id: 'c', value: 'c', label: 'Green' },
      { value: 'teal', label: 'Teal' },
    ]);
    expect(diff.create.map((o) => o.label)).toEqual(['Teal']);
    expect(diff.rename.map((r) => [r.option.id, r.label])).toEqual([['a', 'Crimson']]);
    expect(diff.remove.map((o) => o.id)).toEqual(['b']);
  });

  it('does nothing when nothing changed', () => {
    const diff = diffOptions(
      saved,
      saved.map((o) => ({ id: o.id, value: o.value, label: o.label })),
    );
    expect(diff).toEqual({ create: [], rename: [], remove: [] });
  });

  it('derives a unique value for a new option', () => {
    expect(newOptionValue('Red', [{ value: 'red', label: 'Red' }])).toBe('red_2');
  });
});

describe('dependencies', () => {
  const dep = (over: Partial<FieldDependencyResponse>): FieldDependencyResponse => ({
    id: 'd',
    fieldId: 'p',
    dependsOnFieldId: 'q',
    dependsOnOptionId: null,
    dependsOnValue: null,
    createdAt: '',
    ...over,
  });

  it('diffs conditions into those to add and those to remove', () => {
    const diff = diffConditions(
      [dep({ id: 'keep' }), dep({ id: 'drop' })],
      [
        { id: 'keep', fieldId: 'q', optionId: null, value: 'x' },
        { fieldId: 'q', optionId: 'o', value: '' },
      ],
    );
    expect(diff.remove).toEqual(['drop']);
    expect(diff.create).toHaveLength(1);
  });

  it('reads a dependency as "field = option label" or "field = value"', () => {
    const parent = field({
      id: 'q',
      label: 'Country',
      fieldType: 'select',
      options: [option('oq', 'India')],
    });
    const byId = new Map([[parent.id, parent]]);
    expect(describeCondition(dep({ dependsOnOptionId: 'oq' }), byId)).toEqual({
      field: 'Country',
      value: 'India',
    });
    expect(describeCondition(dep({ dependsOnValue: 'true' }), byId)).toEqual({
      field: 'Country',
      value: 'true',
    });
    expect(describeCondition(dep({ dependsOnFieldId: 'gone' }), byId)).toBeNull();
  });

  it('lists the properties that depend on one', () => {
    expect(
      dependentsOf('q', [dep({ fieldId: 'p' }), dep({ fieldId: 'r', dependsOnFieldId: 'z' })]),
    ).toEqual(['p']);
  });
});

describe('moveRelative', () => {
  it('moves one property to where another is, keeping the ones that are not shown in place', () => {
    const all = ['a', 'hidden', 'b', 'c'];
    // on screen: a, b, c. Moving c above b swaps them in the full order.
    expect(moveRelative(all, 'c', 'b')).toEqual(['a', 'hidden', 'c', 'b']);
    expect(moveRelative(all, 'a', 'c')).toEqual(['hidden', 'b', 'c', 'a']);
    expect(moveRelative(all, 'x', 'c')).toEqual(all);
  });
});

describe('detailGroups', () => {
  const words = { yes: 'Yes', no: 'No' };
  const label = (k: string) => k.toUpperCase();
  const fields = [
    field({ id: 'city', key: 'city', label: 'City', sectionId: 'a', position: 1 }),
    field({
      id: 'plan',
      key: 'plan',
      label: 'Plan',
      fieldType: 'select',
      sectionId: 'a',
      position: 0,
      options: [{ ...option('pro', 'Pro Plan'), value: 'pro' }],
    }),
    field({ id: 'vip', key: 'vip', label: 'VIP', fieldType: 'checkbox', sectionId: 'b' }),
    field({ id: 'secret', key: 'secret', label: 'Secret', isHidden: true, sectionId: 'b' }),
    field({ id: 'old', key: 'old', label: 'Old', isActive: false, sectionId: 'b' }),
  ];
  const sections = [section('a', 0, 'Profile'), section('b', 1, 'Flags')];

  it('lists visible properties with a value under their sections, in order, with readable values', () => {
    const groups = detailGroups(
      fields,
      sections,
      { city: 'Pune', plan: 'pro', vip: false, secret: 'x', old: 'y', empty: '' },
      new Set(['memo']),
      words,
      label,
    );
    expect(groups).toEqual([
      {
        title: 'Profile',
        rows: [
          { key: 'plan', label: 'Plan', value: 'Pro Plan' },
          { key: 'city', label: 'City', value: 'Pune' },
        ],
      },
      { title: 'Flags', rows: [{ key: 'vip', label: 'VIP', value: 'No' }] },
    ]);
  });

  it('adds values with no property behind them last, minus the keys the form owns', () => {
    const groups = detailGroups(
      [],
      [],
      { legacy_id: 'L-9', memo: 'note', count: 3, nested: { a: 1 } },
      new Set(['memo']),
      words,
      label,
    );
    expect(groups).toEqual([
      {
        title: null,
        rows: [
          { key: 'legacy_id', label: 'LEGACY_ID', value: 'L-9' },
          { key: 'count', label: 'COUNT', value: '3' },
        ],
      },
    ]);
  });

  it('does not show the stored value of a hidden or inactive property as a stray one', () => {
    const groups = detailGroups(
      fields,
      sections,
      { secret: 'x', old: 'y' },
      new Set(),
      words,
      label,
    );
    expect(groups).toEqual([]);
  });
});

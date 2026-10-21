import { describe, expect, it } from 'vitest';
import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
} from '@crm/contracts';
import { attributesAfterChange, cascadeOptionsOf, withCascadeChoices } from './cascade';
import { isFieldApplicable } from './field-values';
import { cascadeParentLabels, conditionRulesOf } from './property-model';

const option = (id: string, fieldId: string, value: string, position = 0): FieldOptionResponse =>
  ({
    id,
    fieldId,
    value,
    label: value,
    position,
    isHidden: false,
    rowVersion: 1,
  }) as FieldOptionResponse;

const field = (over: Partial<FieldResponse>): FieldResponse =>
  ({
    fieldType: 'select',
    isRequired: false,
    isMasked: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    isReadOnly: false,
    config: {},
    options: undefined,
    ...over,
  }) as FieldResponse;

const link = (over: Partial<FieldDependencyResponse>): FieldDependencyResponse =>
  ({
    id: 'l',
    fieldId: 'city',
    dependsOnFieldId: 'region',
    dependsOnOptionId: null,
    dependsOnValue: null,
    createdAt: '',
    ...over,
  }) as FieldDependencyResponse;

const pair = (
  id: string,
  parentFieldId: string,
  parentOptionId: string,
  childFieldId: string,
  childOptionId: string,
): FieldOptionDependencyResponse => ({
  id,
  parentFieldId,
  parentOptionId,
  childFieldId,
  childOptionId,
  createdAt: '',
});

// Region (north, south) cascades City (delhi, mumbai, chennai): north allows delhi and mumbai, south allows chennai.
const region = field({
  id: 'region',
  key: 'region',
  label: 'Region',
  options: [option('o-n', 'region', 'north', 0), option('o-s', 'region', 'south', 1)],
});
const city = field({
  id: 'city',
  key: 'city',
  label: 'City',
  options: [
    option('o-d', 'city', 'delhi', 0),
    option('o-m', 'city', 'mumbai', 1),
    option('o-c', 'city', 'chennai', 2),
  ],
});
const byId = new Map([region, city].map((f) => [f.id, f]));
const pairs = [
  pair('p1', 'region', 'o-n', 'city', 'o-d'),
  pair('p2', 'region', 'o-n', 'city', 'o-m'),
  pair('p3', 'region', 'o-s', 'city', 'o-c'),
];
const deps = [link({})];

describe('cascadeOptionsOf', () => {
  it('is null for a property that is not a cascade child: all its choices apply', () => {
    expect(cascadeOptionsOf(city, [], pairs, byId, {})).toBeNull();
  });

  it('offers no choice while the parent holds none (the child waits for its parent)', () => {
    expect(cascadeOptionsOf(city, deps, pairs, byId, {})).toEqual([]);
  });

  it('narrows the choices to the ones the held parent choice allows', () => {
    const north = cascadeOptionsOf(city, deps, pairs, byId, { region: 'north' });
    expect(north?.map((o) => o.value)).toEqual(['delhi', 'mumbai']);
    const south = cascadeOptionsOf(city, deps, pairs, byId, { region: 'south' });
    expect(south?.map((o) => o.value)).toEqual(['chennai']);
  });

  it('ignores "show only when" rules: only a cascade link narrows the choices', () => {
    const gate = link({ id: 'g', dependsOnOptionId: 'o-n' });
    expect(cascadeOptionsOf(city, [gate], pairs, byId, { region: 'south' })).toBeNull();
  });

  it('needs a choice each cascade parent allows when there are several', () => {
    const language = field({
      id: 'lang',
      key: 'lang',
      options: [option('o-hi', 'lang', 'hindi', 0), option('o-en', 'lang', 'english', 1)],
    });
    const lookup = new Map([...byId, [language.id, language]]);
    const both = [link({ id: 'a' }), link({ id: 'b', dependsOnFieldId: 'lang' })];
    const langPairs = [
      ...pairs,
      pair('q1', 'lang', 'o-hi', 'city', 'o-d'),
      pair('q2', 'lang', 'o-en', 'city', 'o-c'),
    ];
    // north allows delhi and mumbai, hindi allows delhi: only delhi satisfies both
    const got = cascadeOptionsOf(city, both, langPairs, lookup, { region: 'north', lang: 'hindi' });
    expect(got?.map((o) => o.value)).toEqual(['delhi']);
  });

  it('keeps every choice when the parent list is not all here (a long list cannot be matched)', () => {
    const longParent = { ...region, optionCount: 5000, options: [] } as FieldResponse;
    const lookup = new Map([
      [longParent.id, longParent],
      [city.id, city],
    ]);
    expect(cascadeOptionsOf(city, deps, pairs, lookup, { region: 'north' })).toBeNull();
  });

  it('keeps every choice when the child list is not all here', () => {
    const longChild = { ...city, optionCount: 5000 } as FieldResponse;
    expect(cascadeOptionsOf(longChild, deps, pairs, byId, { region: 'north' })).toBeNull();
  });
});

describe('withCascadeChoices', () => {
  it('lists each cascade child only its allowed choices, with the count of that list', () => {
    const [, narrowed] = withCascadeChoices([region, city], deps, pairs, { region: 'north' });
    expect(narrowed?.options?.map((o) => o.value)).toEqual(['delhi', 'mumbai']);
    expect(narrowed?.optionCount).toBe(2);
  });

  it('leaves the other properties as they are', () => {
    const out = withCascadeChoices([region, city], deps, pairs, { region: 'north' });
    expect(out[0]).toBe(region);
  });
});

describe('attributesAfterChange', () => {
  it('clears a cascade child whose held choice the parent change no longer allows', () => {
    const before = { region: 'north', city: 'mumbai' };
    const after = attributesAfterChange(before, 'region', 'south', [region, city], deps, pairs);
    expect(after).toEqual({ region: 'south', city: '' });
  });

  it('keeps the child when the new parent still allows its choice', () => {
    const before = { region: 'north', city: 'mumbai' };
    const after = attributesAfterChange(before, 'region', 'north', [region, city], deps, pairs);
    expect(after).toEqual({ region: 'north', city: 'mumbai' });
  });

  it('keeps the rest of a multi-select child that is still allowed', () => {
    const multi = field({
      id: 'city',
      key: 'city',
      fieldType: 'multiselect',
      options: city.options,
    });
    const after = attributesAfterChange(
      { region: 'north', city: ['delhi', 'chennai'] },
      'region',
      'north',
      [region, multi],
      deps,
      pairs,
    );
    // under north only delhi and mumbai are allowed: chennai (a south choice) drops out, delhi stays
    expect(after.city).toEqual(['delhi']);
    const kept = attributesAfterChange(
      { region: 'north', city: ['delhi', 'mumbai'] },
      'region',
      'north',
      [region, multi],
      deps,
      pairs,
    );
    expect(kept.city).toEqual(['delhi', 'mumbai']);
    const cleared = attributesAfterChange(
      { region: 'north', city: ['delhi', 'chennai'] },
      'region',
      'south',
      [region, multi],
      deps,
      pairs,
    );
    expect(cleared.city).toEqual(['chennai']);
  });

  it('clears down a chain: clearing a choice can narrow the next cascade too', () => {
    const district = field({
      id: 'district',
      key: 'district',
      options: [option('o-x', 'district', 'x', 0)],
    });
    const chainLinks = [...deps, link({ id: 'd', fieldId: 'district', dependsOnFieldId: 'city' })];
    const chainPairs = [...pairs, pair('c1', 'city', 'o-d', 'district', 'o-x')];
    const after = attributesAfterChange(
      { region: 'north', city: 'delhi', district: 'x' },
      'region',
      'south',
      [region, city, district],
      chainLinks,
      chainPairs,
    );
    expect(after).toEqual({ region: 'south', city: '', district: '' });
  });
});

describe('a cascade link as a property rule', () => {
  it('does not hide the child: the link is no "show only when" rule', () => {
    expect(isFieldApplicable(city, deps, byId, {})).toBe(true);
  });

  it('is not listed among the property\'s "show only when" rules, but names its parent', () => {
    expect(conditionRulesOf('city', deps)).toEqual([]);
    expect(cascadeParentLabels('city', deps, byId)).toEqual(['Region']);
  });
});

import type { FieldDependencyResponse, FieldResponse } from '@crm/contracts';
import { field, option } from '@/test/contact-properties-fixtures';
import { EMPTY_DRAFT } from './property-values';
import {
  applicableFields,
  collectCustomFields,
  heldOf,
  requiredFieldsOf,
} from './required-properties';

const stamp = '2026-09-01T08:00:00.000Z';

const withOptions = (base: FieldResponse, values: [string, string][]): FieldResponse => ({
  ...base,
  options: values.map(([value, label], i) => option(base.id, value, label, i + 1)),
});

const dependency = (
  fieldId: string,
  dependsOnFieldId: string,
  on: { optionId?: string; value?: string } = {},
): FieldDependencyResponse => ({
  id: `d${fieldId}${dependsOnFieldId}`.slice(0, 36).padEnd(36, '0'),
  fieldId,
  dependsOnFieldId,
  dependsOnOptionId: on.optionId ?? null,
  dependsOnValue: on.value ?? null,
  createdAt: stamp,
});

const firstName = field({
  key: 'first_name',
  label: 'First Name',
  fieldType: 'text',
  isRequired: true,
});
const country = withOptions(
  field({ key: 'country_region', label: 'Country Region', fieldType: 'select', isRequired: true }),
  [
    ['in', 'India'],
    ['us', 'United States'],
  ],
);
const state = withOptions(
  field({ key: 'state_region', label: 'State Region', fieldType: 'select', isRequired: true }),
  [['mh', 'Maharashtra']],
);

describe('requiredFieldsOf', () => {
  it('keeps the properties the API holds a new contact to, in the registry order', () => {
    const later = field({
      key: 'z',
      label: 'Z',
      fieldType: 'text',
      isRequired: true,
      position: 900,
    });
    const earlier = field({
      key: 'a',
      label: 'A',
      fieldType: 'text',
      isRequired: true,
      position: 1,
    });
    expect(requiredFieldsOf([later, earlier]).map((f) => f.key)).toEqual(['a', 'z']);
  });

  it.each([
    ['optional', { isRequired: false }],
    ['switched off', { isActive: false }],
    ['system', { isSystem: true }],
    ['hidden', { isHidden: true }],
    ['read-only', { isReadOnly: true }],
    ['a formula', { fieldType: 'formula' as const }],
    ['a checkbox', { fieldType: 'checkbox' as const }],
    ['a yes/no switch', { fieldType: 'boolean' as const }],
  ])('leaves out a property that is %s', (_name, over) => {
    const f = field({ key: 'x', label: 'X', fieldType: 'text', isRequired: true, ...over });
    expect(requiredFieldsOf([f])).toEqual([]);
  });
});

describe('heldOf', () => {
  it('reads text, a pick and a multiple pick as the strings a dependency compares', () => {
    expect(heldOf(firstName, { ...EMPTY_DRAFT, text: ' Asha ' })).toEqual(['Asha']);
    expect(heldOf(firstName, { ...EMPTY_DRAFT, text: '  ' })).toEqual([]);
    expect(heldOf(country, { ...EMPTY_DRAFT, picked: ['in'] })).toEqual(['in']);
    expect(heldOf(country, undefined)).toEqual([]);
  });
});

describe('applicableFields', () => {
  const all = [firstName, country, state];
  const required = requiredFieldsOf(all);
  const onIndia = dependency(state.id, country.id, { optionId: country.options![0]!.id });

  it('asks for every property that depends on nothing', () => {
    expect(applicableFields(required, [], all, {}).map((f) => f.key)).toEqual([
      'first_name',
      'country_region',
      'state_region',
    ]);
  });

  it('asks for a dependent property only once its parent holds the wanted option', () => {
    expect(applicableFields(required, [onIndia], all, {}).map((f) => f.key)).toEqual([
      'first_name',
      'country_region',
    ]);
    const chosen = { country_region: { ...EMPTY_DRAFT, picked: ['us'] } };
    expect(applicableFields(required, [onIndia], all, chosen).map((f) => f.key)).not.toContain(
      'state_region',
    );
    const india = { country_region: { ...EMPTY_DRAFT, picked: ['in'] } };
    expect(applicableFields(required, [onIndia], all, india).map((f) => f.key)).toContain(
      'state_region',
    );
  });

  it('takes the wanted value from the dependency itself when it has one', () => {
    const byValue = dependency(state.id, country.id, { value: 'us' });
    const us = { country_region: { ...EMPTY_DRAFT, picked: ['us'] } };
    expect(applicableFields(required, [byValue], all, us).map((f) => f.key)).toContain(
      'state_region',
    );
  });

  it('never asks for a property whose condition names no value, as the API never requires it', () => {
    const nothing = dependency(state.id, country.id);
    const india = { country_region: { ...EMPTY_DRAFT, picked: ['in'] } };
    expect(applicableFields(required, [nothing], all, india).map((f) => f.key)).not.toContain(
      'state_region',
    );
  });

  it('ignores a dependency on a property that no longer exists', () => {
    const orphan = dependency(state.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { value: 'x' });
    expect(applicableFields(required, [orphan], all, {}).map((f) => f.key)).toContain(
      'state_region',
    );
  });
});

describe('collectCustomFields', () => {
  it('collects what was typed and picked, by property key', () => {
    const drafts = {
      first_name: { ...EMPTY_DRAFT, text: ' Asha ' },
      country_region: { ...EMPTY_DRAFT, picked: ['in'] },
    };
    expect(collectCustomFields([firstName, country], drafts)).toEqual({
      ok: true,
      value: { first_name: 'Asha', country_region: 'in' },
    });
  });

  it('says which required properties are empty, naming each by its label', () => {
    const result = collectCustomFields([firstName, country], {});
    expect(result).toEqual({
      ok: false,
      problems: {
        first_name: { error: 'required', params: { label: 'First Name' } },
        country_region: { error: 'required', params: { label: 'Country Region' } },
      },
    });
  });

  it('holds a value to its type', () => {
    const visits = field({
      key: 'visits',
      label: 'Visits',
      fieldType: 'integer',
      isRequired: true,
    });
    const result = collectCustomFields([visits], { visits: { ...EMPTY_DRAFT, text: '2.5' } });
    expect(result).toEqual({
      ok: false,
      problems: { visits: { error: 'whole', params: undefined } },
    });
    expect(collectCustomFields([visits], { visits: { ...EMPTY_DRAFT, text: '4' } })).toEqual({
      ok: true,
      value: { visits: 4 },
    });
  });

  it('reports a property the app cannot fill in instead of sending it empty', () => {
    const link = field({ key: 'account', label: 'Account', fieldType: 'lookup', isRequired: true });
    expect(collectCustomFields([link], {})).toEqual({
      ok: false,
      problems: { account: { error: 'unsupported' } },
    });
  });
});

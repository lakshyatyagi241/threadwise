import { describe, expect, it } from 'vitest';
import type { FieldDependencyResponse, FieldResponse, FieldSectionResponse } from '@crm/contracts';
import {
  createValues,
  inputsOf,
  isShownProperty,
  isWritableProperty,
  propertyProblems,
  shownGroups,
  updateValues,
} from './properties';

let n = 0;
const field = (key: string, over: Partial<FieldResponse> = {}): FieldResponse => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  moduleKey: 'companies',
  sectionId: null,
  key,
  label: key.toUpperCase(),
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
  position: n,
  config: {},
  replacesFieldId: null,
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const option = (value: string, label: string, position = 0) => ({
  id: `00000000-0000-4000-9000-${value.padStart(12, '0')}`,
  value,
  label,
  position,
  isHidden: false,
  rowVersion: 1,
});

const tier = field('tier', {
  fieldType: 'select',
  options: [option('gold', 'Gold'), option('silver', 'Silver', 1)] as FieldResponse['options'],
});
const seats = field('seats', { fieldType: 'integer' });
const vip = field('vip', { fieldType: 'checkbox' });
const vat = field('vat', { isRequired: true });
const tags = field('tags', {
  fieldType: 'multiselect',
  options: [option('a', 'Alpha'), option('b', 'Beta', 1)] as FieldResponse['options'],
});
const locked = field('locked', { isReadOnly: true });
const hidden = field('hidden', { isHidden: true });
const gone = field('gone', { isActive: false });
const system = field('sys', { isSystem: true });
const all = [tier, seats, vip, vat, tags, locked, hidden, gone, system];

describe('which properties a person sees and can write', () => {
  it('shows the workspace’s own active, visible properties', () => {
    expect(all.filter(isShownProperty).map((f) => f.key)).toEqual([
      'tier',
      'seats',
      'vip',
      'vat',
      'tags',
      'locked',
    ]);
  });
  it('writes those that are not read-only or computed', () => {
    expect(all.filter(isWritableProperty).map((f) => f.key)).toEqual([
      'tier',
      'seats',
      'vip',
      'vat',
      'tags',
    ]);
    expect(isWritableProperty(field('f', { fieldType: 'formula' }))).toBe(false);
  });
});

describe('inputsOf', () => {
  it('turns what a company holds into form inputs: text, a list, "true"/"false"', () => {
    const inputs = inputsOf(all, { tier: 'gold', seats: 12, vip: true, tags: ['a'], gone: 'x' });
    expect(inputs).toMatchObject({
      tier: 'gold',
      seats: '12',
      vip: 'true',
      vat: '',
      tags: ['a'],
    });
    expect(inputs).not.toHaveProperty('gone');
    expect(inputs).not.toHaveProperty('hidden');
  });
});

describe('propertyProblems', () => {
  it('a required property with no answer, and a malformed number, are flagged', () => {
    expect(propertyProblems(all, [], { ...inputsOf(all, {}), seats: 'abc' })).toEqual({
      vat: 'required',
      seats: 'number',
    });
  });
  it('a whole-number property refuses a fraction; a good form has no problems', () => {
    expect(propertyProblems(all, [], { ...inputsOf(all, { vat: 'DE1' }), seats: '1.5' })).toEqual({
      seats: 'integer',
    });
    expect(propertyProblems(all, [], inputsOf(all, { vat: 'DE1' }))).toEqual({});
  });
  it('a property whose "show only when" rule is unmet cannot be required', () => {
    const dep: FieldDependencyResponse = {
      id: '00000000-0000-4000-a000-000000000001',
      fieldId: vat.id,
      dependsOnFieldId: tier.id,
      dependsOnOptionId: null,
      dependsOnValue: 'gold',
      createdAt: '2026-10-01T00:00:00.000Z',
    } as FieldDependencyResponse;
    expect(propertyProblems(all, [dep], inputsOf(all, { tier: 'silver' }))).toEqual({});
    expect(propertyProblems(all, [dep], inputsOf(all, { tier: 'gold' }))).toEqual({
      vat: 'required',
    });
  });
});

describe('createValues', () => {
  it('sends only answered, writable properties, with real types', () => {
    const inputs = {
      ...inputsOf(all, {}),
      tier: 'gold',
      seats: '12',
      vip: 'true',
      vat: ' DE1 ',
      tags: ['a', 'b'],
      locked: 'nope',
    };
    expect(createValues(all, [], inputs)).toEqual({
      tier: 'gold',
      seats: 12,
      vip: true,
      vat: 'DE1',
      tags: ['a', 'b'],
    });
  });
  it('sends nothing for blanks and unticked boxes', () => {
    expect(createValues(all, [], inputsOf(all, {}))).toEqual({});
  });
});

describe('updateValues', () => {
  const stored = { tier: 'gold', seats: 12, vip: true, vat: 'DE1', tags: ['a'], locked: 'x' };

  it('sends nothing for an untouched form', () => {
    expect(updateValues(all, [], inputsOf(all, stored), stored)).toBeNull();
  });
  it('sends only what changed, null clearing a property', () => {
    const inputs = {
      ...inputsOf(all, stored),
      seats: '15',
      tier: '',
      vip: 'false',
      tags: ['a', 'b'],
    };
    expect(updateValues(all, [], inputs, stored)).toEqual({
      seats: 15,
      tier: null,
      vip: null,
      tags: ['a', 'b'],
    });
  });
  it('an unticked box on a company that never had one is not a change', () => {
    expect(updateValues(all, [], inputsOf(all, { vat: 'x' }), { vat: 'x' })).toBeNull();
  });
  it('leaves a read-only property alone even when its input differs', () => {
    expect(
      updateValues(all, [], { ...inputsOf(all, stored), locked: 'changed' }, stored),
    ).toBeNull();
  });
});

describe('shownGroups (the company page’s properties card)', () => {
  const section = (id: string, name: string, position: number): FieldSectionResponse =>
    ({ id, moduleKey: 'companies', name, position, rowVersion: 1 }) as FieldSectionResponse;
  const s1 = section('00000000-0000-4000-b000-000000000001', 'Billing', 1);
  const words = { yes: 'Yes', no: 'No' };

  it('lists only properties that hold a value, with option labels and Yes/No, under their sections', () => {
    const inSection = { ...vat, sectionId: s1.id };
    const groups = shownGroups(
      [tier, inSection, vip, seats],
      [s1],
      { tier: 'gold', vat: 'DE1', vip: true },
      words,
    );
    expect(groups.map((g) => g.section?.name ?? null)).toEqual(['Billing', null]);
    expect(groups[0]!.values.map((v) => [v.field.key, v.text])).toEqual([['vat', 'DE1']]);
    expect(groups[1]!.values.map((v) => [v.field.key, v.text])).toEqual([
      ['tier', 'Gold'],
      ['vip', 'Yes'],
    ]);
  });
  it('shows nothing for an inactive or hidden property, an unticked box or no values at all', () => {
    expect(
      shownGroups([gone, hidden, vip], [], { gone: 'x', hidden: 'y', vip: false }, words),
    ).toEqual([]);
  });
});

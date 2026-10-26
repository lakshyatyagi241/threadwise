import { describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import {
  addableProperties,
  bulkBuiltInValues,
  bulkCustomFields,
  bulkPropertyProblem,
  bulkPropertyProblems,
  builtInFields,
  changesAfter,
  isBulkEditable,
  startingChange,
  waitingParents,
  withBulkCascade,
  type BulkPropertyChanges,
} from './bulk-properties';

const f = (key: string, fieldType: FieldResponse['fieldType'], over: Partial<FieldResponse> = {}) =>
  ({
    id: key,
    key,
    label: key.toUpperCase(),
    fieldType,
    isRequired: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    position: 0,
    ...over,
  }) as FieldResponse;

const fields = [
  f('city', 'text', { label: 'City', position: 2 }),
  f('budget', 'integer', { label: 'Budget', position: 1 }),
  f('tier', 'select', { label: 'Tier', position: 3 }),
  f('vip', 'checkbox', { label: 'VIP', position: 4 }),
  f('tags', 'multiselect', { label: 'Interests', position: 5 }),
  f('joined', 'date', { label: 'Joined', position: 6 }),
  f('site', 'url', { label: 'Website', position: 7 }),
  f('contact', 'email', { label: 'Alt email', position: 8, isRequired: true }),
  f('old', 'text', { isActive: false }),
  f('sys', 'text', { isSystem: true }),
  f('hid', 'text', { isHidden: true }),
  f('ro', 'text', { isReadOnly: true }),
  f('calc', 'formula'),
];
const byKey = new Map(fields.map((x) => [x.key, x]));

describe('isBulkEditable / addableProperties', () => {
  it('offers only active, own, visible, writable, non-formula properties', () => {
    expect(fields.filter(isBulkEditable).map((x) => x.key)).toEqual([
      'city',
      'budget',
      'tier',
      'vip',
      'tags',
      'joined',
      'site',
      'contact',
    ]);
  });
  it('lists them in screen order, skips the ones already added and filters by label or key', () => {
    expect(
      addableProperties(fields, {}, '')
        .map((x) => x.key)
        .slice(0, 3),
    ).toEqual(['budget', 'city', 'tier']);
    const added: BulkPropertyChanges = { city: { mode: 'clear' } };
    expect(addableProperties(fields, added, '').some((x) => x.key === 'city')).toBe(false);
    expect(addableProperties(fields, {}, '  ALT ').map((x) => x.key)).toEqual(['contact']);
    expect(addableProperties(fields, {}, 'bud').map((x) => x.key)).toEqual(['budget']);
    expect(addableProperties(fields, {}, 'zzz')).toEqual([]);
  });
});

describe('bulkCustomFields (the payload)', () => {
  it('is undefined when nothing was changed', () => {
    expect(bulkCustomFields({}, byKey)).toBeUndefined();
  });
  it('sends set values in their stored type and clears as null; Keep is absent', () => {
    const changes: BulkPropertyChanges = {
      city: { mode: 'set', value: '  Pune ' },
      budget: { mode: 'set', value: '1500' },
      vip: { mode: 'set', value: 'false' },
      tags: { mode: 'set', value: ['a', 'b'] },
      joined: { mode: 'set', value: '2026-03-04' },
      tier: { mode: 'clear' },
    };
    expect(bulkCustomFields(changes, byKey)).toEqual({
      city: 'Pune',
      budget: 1500,
      vip: false,
      tags: ['a', 'b'],
      joined: '2026-03-04',
      tier: null,
    });
  });
  it('drops a property that is no longer in the registry', () => {
    expect(bulkCustomFields({ gone: { mode: 'clear' } }, byKey)).toBeUndefined();
  });
});

describe('bulkPropertyProblem(s)', () => {
  it('a set property with no value asks for a value or Clear; a checkbox never does', () => {
    expect(bulkPropertyProblem(byKey.get('city')!, startingChange(byKey.get('city')!))).toBe(
      'empty',
    );
    expect(bulkPropertyProblem(byKey.get('tags')!, startingChange(byKey.get('tags')!))).toBe(
      'empty',
    );
    expect(bulkPropertyProblem(byKey.get('vip')!, startingChange(byKey.get('vip')!))).toBeNull();
  });
  it('checks each type like the contact form', () => {
    expect(bulkPropertyProblem(byKey.get('budget')!, { mode: 'set', value: 'abc' })).toBe('number');
    expect(bulkPropertyProblem(byKey.get('budget')!, { mode: 'set', value: '1.5' })).toBe(
      'integer',
    );
    expect(bulkPropertyProblem(byKey.get('site')!, { mode: 'set', value: 'geta.ai' })).toBe('url');
    expect(
      bulkPropertyProblem(byKey.get('site')!, { mode: 'set', value: 'https://geta.ai' }),
    ).toBeNull();
    expect(bulkPropertyProblem(byKey.get('contact')!, { mode: 'set', value: 'nope' })).toBe(
      'email',
    );
  });
  it('a required property can be set but not cleared', () => {
    expect(bulkPropertyProblem(byKey.get('contact')!, { mode: 'clear' })).toBe('required');
    expect(bulkPropertyProblem(byKey.get('contact')!, { mode: 'set', value: 'a@b.co' })).toBeNull();
    expect(bulkPropertyProblem(byKey.get('city')!, { mode: 'clear' })).toBeNull();
  });
  it('lists the problems by key and ignores unknown keys', () => {
    expect(
      bulkPropertyProblems(
        {
          city: { mode: 'set', value: '' },
          budget: { mode: 'set', value: '5' },
          gone: { mode: 'set', value: '' },
        },
        byKey,
      ),
    ).toEqual({ city: 'empty' });
  });
});

describe('built-in properties in a bulk update', () => {
  const label = (k: string) => k;
  const all = [...builtInFields(label), ...fields];
  const byKey = new Map(all.map((x) => [x.key, x]));

  it('offers first name, last name, source and the text properties in the same list', () => {
    const keys = addableProperties(all, {}, '').map((x) => x.key);
    expect(keys.slice(0, 7)).toEqual([
      'first_name',
      'last_name',
      'middle_name',
      'language',
      'source',
      'address',
      'memo',
    ]);
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('email');
  });

  it('sends names and source as request fields and the rest as reserved custom keys', () => {
    const changes: BulkPropertyChanges = {
      first_name: { mode: 'set', value: ' Asha ' },
      last_name: { mode: 'clear' },
      source: { mode: 'set', value: 'Fair' },
      memo: { mode: 'set', value: 'VIP' },
      city: { mode: 'set', value: 'Pune' },
    };
    expect(bulkBuiltInValues(changes, byKey)).toEqual({
      firstName: 'Asha',
      lastName: null,
      source: 'Fair',
    });
    expect(bulkCustomFields(changes, byKey)).toEqual({ memo: 'VIP', city: 'Pune' });
  });

  it('refuses to clear or blank the first name', () => {
    const first = byKey.get('first_name')!;
    expect(bulkPropertyProblem(first, { mode: 'clear' })).toBe('required');
    expect(bulkPropertyProblem(first, { mode: 'set', value: ' ' })).toBe('empty');
  });
});

describe('dependent properties in a bulk update', () => {
  const parent = f('country', 'select', {
    id: 'p',
    options: [
      { id: 'o-in', value: 'in', label: 'India' },
      { id: 'o-us', value: 'us', label: 'USA' },
    ] as FieldResponse['options'],
  });
  const child = f('state', 'select', {
    id: 'c',
    options: [
      { id: 'o-mh', value: 'mh', label: 'Maharashtra' },
      { id: 'o-ca', value: 'ca', label: 'California' },
    ] as FieldResponse['options'],
  });
  const list = [parent, child];
  const deps = [
    { id: 'd', fieldId: 'c', dependsOnFieldId: 'p', dependsOnOptionId: null, dependsOnValue: null },
  ] as never;
  const pairs = [
    { childFieldId: 'c', childOptionId: 'o-mh', parentFieldId: 'p', parentOptionId: 'o-in' },
    { childFieldId: 'c', childOptionId: 'o-ca', parentFieldId: 'p', parentOptionId: 'o-us' },
  ] as never;

  it('waits for the parent to hold a value to set', () => {
    expect(waitingParents(child, deps, list, {}).map((p) => p.key)).toEqual(['country']);
    expect(waitingParents(child, deps, list, { country: { mode: 'set', value: '' } })).toHaveLength(
      1,
    );
    expect(
      waitingParents(child, deps, list, { country: { mode: 'set', value: 'in' } }),
    ).toHaveLength(0);
    expect(waitingParents(parent, deps, list, {})).toHaveLength(0);
  });

  it('narrows the child to what the parent value allows', () => {
    const shown = withBulkCascade(list, deps, pairs, { country: { mode: 'set', value: 'in' } });
    expect(shown.find((x) => x.key === 'state')?.options?.map((o) => o.value)).toEqual(['mh']);
  });

  it('empties a child value the new parent value no longer allows, and drops a child with no parent row', () => {
    const start: BulkPropertyChanges = {
      country: { mode: 'set', value: 'in' },
      state: { mode: 'set', value: 'mh' },
    };
    const moved = changesAfter(start, 'country', { mode: 'set', value: 'us' }, list, deps, pairs);
    expect(moved.state).toEqual({ mode: 'set', value: '' });
    const removed = changesAfter(start, 'country', null, list, deps, pairs);
    expect(removed).toEqual({});
  });
});

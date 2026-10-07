import { describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import {
  addableProperties,
  bulkCustomFields,
  bulkPropertyProblem,
  bulkPropertyProblems,
  isBulkEditable,
  startingChange,
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

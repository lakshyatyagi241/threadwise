import { describe, expect, it } from 'vitest';
import { isAddressProperty, missingAddressParts, sectionProperties } from './build-view';
import { PROPERTIES } from '../test-fixtures';
import type { CrmProperty } from './types';

const prop = (
  object: 'contact' | 'company',
  property: string,
  label: string,
  source: 'builtin' | 'custom' = 'builtin',
): CrmProperty => ({
  object,
  property,
  label,
  source,
  type: 'text',
  suggestedKind: 'short_text',
  requiredByWorkspace: false,
});

const ADDRESS = [
  prop('contact', 'address', 'Full address'),
  prop('contact', 'address_country', 'Country'),
  prop('contact', 'address_line', 'Street'),
  prop('contact', 'address_city', 'City'),
  prop('contact', 'address_postal_code', 'Postal code'),
  prop('contact', 'address_state', 'State or region'),
  prop('company', 'address_city', 'Company city'),
  prop('company', 'address', 'Company full address'),
];

describe('palette sections', () => {
  it('puts each object first, then its address, parts in natural order and the whole line last', () => {
    const sections = sectionProperties([...PROPERTIES, ...ADDRESS], '');
    expect(sections.map((s) => s.id)).toEqual([
      'contact',
      'contactAddress',
      'company',
      'companyAddress',
    ]);
    expect(sections[1]!.items.map((p) => p.property)).toEqual([
      'address_line',
      'address_city',
      'address_state',
      'address_postal_code',
      'address_country',
      'address',
    ]);
    expect(sections[0]!.items.some(isAddressProperty)).toBe(false);
  });

  it('a custom property whose key looks like an address part is not an address property', () => {
    const custom = prop('contact', 'address_notes', 'Address notes', 'custom');
    expect(isAddressProperty(custom)).toBe(false);
    expect(sectionProperties([custom], '').map((s) => s.id)).toEqual(['contact']);
  });

  it('search narrows every section and drops the empty ones', () => {
    const sections = sectionProperties([...PROPERTIES, ...ADDRESS], 'city');
    expect(sections.map((s) => s.id)).toEqual(['contactAddress', 'companyAddress']);
    expect(sections.flatMap((s) => s.items.map((p) => p.property))).toEqual([
      'address_city',
      'address_city',
    ]);
  });

  it('"add all" offers the parts not yet on the form, never the whole address line', () => {
    const address = sectionProperties(ADDRESS, '').find((x) => x.id === 'contactAddress');
    const all = missingAddressParts(address!, () => false);
    expect(all.map((p) => p.property)).toEqual([
      'address_line',
      'address_city',
      'address_state',
      'address_postal_code',
      'address_country',
    ]);
    const some = missingAddressParts(address!, (p) =>
      ['address_city', 'address_line'].includes(p.property),
    );
    expect(some.map((p) => p.property)).toEqual([
      'address_state',
      'address_postal_code',
      'address_country',
    ]);
    expect(missingAddressParts(address!, () => true)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { composeAddress, formDefinitionSchema, type FormDefinitionInput } from '@crm/contracts';
import { isBuiltinProperty, mapAnswers } from '../../../src/modules/forms-builder/form-rules';

const f = (id: string, property: string, object: 'contact' | 'company' = 'contact') => ({
  id,
  type: 'field',
  kind: 'short_text',
  label: id,
  bind: { object, property },
});
const make = (blocks: unknown[]) =>
  formDefinitionSchema.parse({ title: 'T', steps: [{ id: 's', blocks }] } as FormDefinitionInput);

describe('composeAddress', () => {
  it('joins street, city, "state postal", country; empty parts drop out with their separators', () => {
    expect(
      composeAddress({
        address_line: '12 Park Street',
        address_city: 'Kolkata',
        address_state: 'West Bengal',
        address_postal_code: '700016',
        address_country: 'India',
      }),
    ).toBe('12 Park Street, Kolkata, West Bengal 700016, India');
    expect(composeAddress({ address_city: 'Pune', address_country: 'India' })).toBe('Pune, India');
    expect(composeAddress({ address_postal_code: '411001' })).toBe('411001');
    expect(composeAddress({ address_line: '  ', address_city: '' })).toBeNull();
    expect(composeAddress({})).toBeNull();
  });
});

describe('mapAnswers: address parts and the contact built-ins', () => {
  it('knows the new built-ins for both objects', () => {
    for (const p of [
      'middle_name',
      'address_line',
      'address_city',
      'address_state',
      'address_postal_code',
      'address_country',
    ]) {
      expect(isBuiltinProperty('contact', p), `contact ${p}`).toBe(true);
    }
    expect(isBuiltinProperty('company', 'address_city')).toBe(true);
    expect(isBuiltinProperty('company', 'middle_name')).toBe(false);
  });

  it('writes the parts as the one address line and leaves no part behind', () => {
    const def = make([
      f('street', 'address_line'),
      f('city', 'address_city'),
      f('zip', 'address_postal_code'),
      f('mid', 'middle_name'),
    ]);
    const m = mapAnswers(def, {
      street: '12 Park Street',
      city: 'Kolkata',
      zip: '700016',
      mid: 'Chandra',
    });
    expect(m.contact.builtin).toEqual({
      middle_name: 'Chandra',
      address: '12 Park Street, Kolkata, 700016',
    });
    expect(m.contact.custom).toEqual({});
  });

  it('a field bound to the whole address wins over the parts', () => {
    const def = make([f('all', 'address'), f('city', 'address_city')]);
    const m = mapAnswers(def, { all: '1 Main Rd, Delhi', city: 'Mumbai' });
    expect(m.contact.builtin).toEqual({ address: '1 Main Rd, Delhi' });
  });

  it('contact and company addresses are composed separately', () => {
    const def = make([
      f('c_city', 'address_city', 'contact'),
      f('o_city', 'address_city', 'company'),
      f('o_country', 'address_country', 'company'),
    ]);
    const m = mapAnswers(def, { c_city: 'Pune', o_city: 'Mumbai', o_country: 'India' });
    expect(m.contact.builtin).toEqual({ address: 'Pune' });
    expect(m.company.builtin).toEqual({ address: 'Mumbai, India' });
  });

  it('blank parts add nothing', () => {
    const def = make([f('city', 'address_city')]);
    expect(mapAnswers(def, { city: '   ' }).contact.builtin).toEqual({});
  });
});

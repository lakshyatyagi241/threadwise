import { describe, expect, it } from 'vitest';
import { extractFieldMappings } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/wa-form-records';
import { writesFor } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/commerce-resume';

describe('extractFieldMappings', () => {
  it('collects field id -> mapsTo across every screen, skipping fields with none', () => {
    const definition = {
      screens: [
        { id: 'A', fields: [{ id: 'fld_1', mapsTo: 'email' }, { id: 'fld_2' }] },
        { id: 'B', fields: [{ id: 'fld_3', mapsTo: 'custom_city' }] },
      ],
    };
    expect(extractFieldMappings(definition)).toEqual({ fld_1: 'email', fld_3: 'custom_city' });
  });

  it('never throws on malformed or missing definitions', () => {
    expect(extractFieldMappings(null)).toEqual({});
    expect(extractFieldMappings(undefined)).toEqual({});
    expect(extractFieldMappings({})).toEqual({});
    expect(extractFieldMappings({ screens: [{}] })).toEqual({});
    expect(extractFieldMappings({ screens: [{ fields: [{ id: 1, mapsTo: 'email' }] }] })).toEqual({});
    expect(extractFieldMappings({ screens: [{ fields: [{ id: 'fld_1', mapsTo: '' }] }] })).toEqual({});
  });
});

describe('writesFor', () => {
  it('pairs a mapped field with its flattened answer when the submission has one', () => {
    const mappings = { fld_1: 'email', fld_2: 'custom_city' };
    const answers = { fld_1: 'a@b.com', fld_2: { title: 'Pune' } };
    expect(writesFor(mappings, answers)).toEqual([
      { fieldId: 'fld_1', mapsTo: 'email', value: 'a@b.com' },
      { fieldId: 'fld_2', mapsTo: 'custom_city', value: 'Pune' },
    ]);
  });

  it('skips a mapped field the submission never answered, and one answered blank', () => {
    const mappings = { fld_1: 'email', fld_2: 'name', fld_3: 'address' };
    const answers = { fld_1: 'a@b.com', fld_2: '' };
    expect(writesFor(mappings, answers)).toEqual([
      { fieldId: 'fld_1', mapsTo: 'email', value: 'a@b.com' },
    ]);
  });

  it('writes nothing when no field is mapped', () => {
    expect(writesFor({}, { fld_1: 'a@b.com' })).toEqual([]);
  });
});

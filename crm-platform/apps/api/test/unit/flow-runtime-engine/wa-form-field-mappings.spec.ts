import { describe, expect, it } from 'vitest';
import type { WaFormPrivacyMapField } from '@crm/contracts';
import { extractFieldMappings } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/wa-form-records';
import { privacyActionFor, writesFor } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/commerce-resume';

describe('extractFieldMappings', () => {
  it('collects field id -> {mapsTo, kind, label} across every screen, skipping fields with none', () => {
    const definition = {
      screens: [
        {
          id: 'A',
          fields: [
            { id: 'fld_1', kind: 'email', label: 'Email', mapsTo: 'email' },
            { id: 'fld_2', kind: 'short_text', label: 'Notes' },
          ],
        },
        { id: 'B', fields: [{ id: 'fld_3', kind: 'short_text', label: 'City', mapsTo: 'custom_city' }] },
      ],
    };
    expect(extractFieldMappings(definition)).toEqual({
      fld_1: { mapsTo: 'email', kind: 'email', label: 'Email' },
      fld_3: { mapsTo: 'custom_city', kind: 'short_text', label: 'City' },
    });
  });

  it('never throws on malformed or missing definitions', () => {
    expect(extractFieldMappings(null)).toEqual({});
    expect(extractFieldMappings(undefined)).toEqual({});
    expect(extractFieldMappings({})).toEqual({});
    expect(extractFieldMappings({ screens: [{}] })).toEqual({});
    expect(extractFieldMappings({ screens: [{ fields: [{ id: 1, mapsTo: 'email' }] }] })).toEqual({});
    expect(extractFieldMappings({ screens: [{ fields: [{ id: 'fld_1', mapsTo: '' }] }] })).toEqual({});
  });

  it('defaults a missing kind or label to an empty string rather than throwing', () => {
    expect(extractFieldMappings({ screens: [{ fields: [{ id: 'fld_1', mapsTo: 'email' }] }] })).toEqual({
      fld_1: { mapsTo: 'email', kind: '', label: '' },
    });
  });
});

const mapping = (mapsTo: string, kind: string, label = '') => ({ mapsTo, kind, label });

describe('writesFor', () => {
  it('pairs a mapped field with its flattened answer when the submission has one', () => {
    const mappings = { fld_1: mapping('email', 'email'), fld_2: mapping('custom_city', 'short_text') };
    const answers = { fld_1: 'a@b.com', fld_2: { title: 'Pune' } };
    expect(writesFor(mappings, answers)).toEqual([
      { fieldId: 'fld_1', mapsTo: 'email', kind: 'email', label: '', value: 'a@b.com' },
      { fieldId: 'fld_2', mapsTo: 'custom_city', kind: 'short_text', label: '', value: 'Pune' },
    ]);
  });

  it('skips a mapped field the submission never answered, and one answered blank', () => {
    const mappings = {
      fld_1: mapping('email', 'email'),
      fld_2: mapping('name', 'short_text'),
      fld_3: mapping('address', 'short_text'),
    };
    const answers = { fld_1: 'a@b.com', fld_2: '' };
    expect(writesFor(mappings, answers)).toEqual([
      { fieldId: 'fld_1', mapsTo: 'email', kind: 'email', label: '', value: 'a@b.com' },
    ]);
  });

  it('writes nothing when no field is mapped', () => {
    expect(writesFor({}, { fld_1: 'a@b.com' })).toEqual([]);
  });
});

describe('privacyActionFor', () => {
  const asAge = 'privacy:age' as WaFormPrivacyMapField;
  const asDob = 'privacy:date_of_birth' as WaFormPrivacyMapField;
  const asMarketing = 'privacy:consent_marketing' as WaFormPrivacyMapField;
  const asService = 'privacy:consent_service' as WaFormPrivacyMapField;
  const now = new Date('2026-10-17T00:00:00.000Z');

  it('flags a minor from an under-age number answer, with source dob', () => {
    const action = privacyActionFor(asAge, 'number', '15', 18, now);
    expect(action.kind).toBe('flag_minor');
    if (action.kind === 'flag_minor') {
      expect(action.source).toBe('dob');
      expect(action.minorUntil).not.toBeNull();
    }
  });

  it('writes nothing for an adult age answer', () => {
    expect(privacyActionFor(asAge, 'number', '25', 18, now)).toEqual({ kind: 'none' });
  });

  it('flags a minor from an under-age date-of-birth answer', () => {
    const action = privacyActionFor(asDob, 'date', '2015-01-01', 18, now);
    expect(action.kind).toBe('flag_minor');
  });

  it('is a kind mismatch when the field kind does not match the privacy key', () => {
    expect(privacyActionFor(asAge, 'short_text', '15', 18, now)).toEqual({ kind: 'kind_mismatch' });
    expect(privacyActionFor(asDob, 'number', '2015-01-01', 18, now)).toEqual({ kind: 'kind_mismatch' });
    expect(privacyActionFor(asMarketing, 'short_text', 'I agree', 18, now)).toEqual({ kind: 'kind_mismatch' });
  });

  it('grants marketing consent for a ticked checkbox mapped to consent_marketing', () => {
    expect(privacyActionFor(asMarketing, 'checkbox', 'I agree', 18, now)).toEqual({
      kind: 'grant',
      purpose: 'marketing',
    });
  });

  it('grants a utility (non-marketing) agreement for consent_service', () => {
    expect(privacyActionFor(asService, 'checkbox', 'I agree', 18, now)).toEqual({
      kind: 'grant',
      purpose: 'utility',
    });
  });

  it('is invalid (none), not a crash, for an unreadable age or date', () => {
    expect(privacyActionFor(asAge, 'number', 'not a number', 18, now)).toEqual({ kind: 'none' });
    expect(privacyActionFor(asDob, 'date', 'not a date', 18, now)).toEqual({ kind: 'none' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  canonicalZone,
  contactTimezoneSchema,
  createContactSchema,
  detectImportColumns,
  updateContactSchema,
} from '@crm/contracts';

/** The contact time zone (BL-193): what counts as a zone, how it is spelled, where the contracts accept it. */
describe('canonicalZone', () => {
  it('spells a zone the way the runtime does and refuses what is not one', () => {
    expect(canonicalZone('asia/kolkata')).toBe('Asia/Kolkata');
    expect(canonicalZone('  America/New_York ')).toBe('America/New_York');
    expect(canonicalZone('UTC')).toBe('UTC');
    expect(canonicalZone('Mars/Olympus')).toBeNull();
    expect(canonicalZone('')).toBeNull();
    expect(canonicalZone(null)).toBeNull();
  });
});

describe('contactTimezoneSchema', () => {
  it('accepts a real zone in any case and stores the canonical spelling', () => {
    expect(contactTimezoneSchema.parse('europe/london')).toBe('Europe/London');
  });

  it('refuses a made-up zone, a blank and an over-long name', () => {
    expect(contactTimezoneSchema.safeParse('Nowhere/Land').success).toBe(false);
    expect(contactTimezoneSchema.safeParse('   ').success).toBe(false);
    expect(contactTimezoneSchema.safeParse('A'.repeat(65)).success).toBe(false);
  });
});

describe('where the contracts take a time zone', () => {
  it('a create carries it, an update can clear it with null, a bad one is refused', () => {
    expect(
      createContactSchema.parse({ phone: '+919812345678', timezone: 'asia/dubai' }).timezone,
    ).toBe('Asia/Dubai');
    expect(updateContactSchema.parse({ timezone: null, rowVersion: 1 }).timezone).toBeNull();
    expect(updateContactSchema.safeParse({ timezone: 'Mars/Olympus', rowVersion: 1 }).success).toBe(
      false,
    );
  });

  it('the importer recognises a time zone column under its usual names', () => {
    expect(detectImportColumns(['name', 'Time Zone'])).toMatchObject({ timezone: 1 });
    expect(detectImportColumns(['name', 'tz'])).toMatchObject({ timezone: 1 });
    expect(detectImportColumns(['name', 'TIMEZONE'])).toMatchObject({ timezone: 1 });
  });
});

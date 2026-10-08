import { describe, expect, it } from 'vitest';
import {
  SET_GROUPS,
  SET_GROUP_SCHEMAS,
  SET_SECRET_FIELDS,
  isValidTimezone,
  setPatchSchemaFor,
} from '@crm/contracts';

describe('settings group schemas', () => {
  it('every group reads whole from nothing (defaults for every field)', () => {
    for (const g of SET_GROUPS) {
      expect(SET_GROUP_SCHEMAS[g].safeParse({}).success, g).toBe(true);
    }
  });

  it('TW-SET-005: an empty app name is refused, an invalid app URL too', () => {
    const general = SET_GROUP_SCHEMAS.general;
    expect(general.safeParse({ appName: '' }).success).toBe(false);
    expect(general.safeParse({ appName: '   ' }).success).toBe(false);
    expect(general.safeParse({ appUrl: 'not a url' }).success).toBe(false);
    expect(general.safeParse({ appName: 'Acme Chat', appUrl: 'https://acme.test' }).success).toBe(
      true,
    );
    expect(general.safeParse({ appName: 'x'.repeat(81) }).success).toBe(false);
  });

  it('links that reach public pages must be http(s): javascript: and data: are refused', () => {
    expect(SET_GROUP_SCHEMAS.site.safeParse({ socialX: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(SET_GROUP_SCHEMAS.general.safeParse({ mapIframeUrl: 'data:text/html,x' }).success).toBe(
      false,
    );
    expect(SET_GROUP_SCHEMAS.site.safeParse({ socialX: 'https://x.com/acme' }).success).toBe(true);
  });

  it('TW-SET-006: country iso must be two letters, timezone must exist, currency is upper-cased', () => {
    const general = SET_GROUP_SCHEMAS.general;
    expect(general.safeParse({ defaultCountryIso: 'ind' }).success).toBe(false);
    expect(general.parse({ defaultCountryIso: 'ID' }).defaultCountryIso).toBe('id');
    expect(general.safeParse({ defaultTimezone: 'Mars/Olympus' }).success).toBe(false);
    expect(general.parse({ defaultTimezone: 'Asia/Kolkata' }).defaultTimezone).toBe('Asia/Kolkata');
    expect(general.parse({ defaultCurrency: 'inr' }).defaultCurrency).toBe('INR');
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('nope')).toBe(false);
  });

  it('TW-SET-024: mail port must be 1-65535 and the mailer one of the known ones', () => {
    const mail = SET_GROUP_SCHEMAS.mail;
    expect(mail.safeParse({ port: 70000 }).success).toBe(false);
    expect(mail.safeParse({ port: 0 }).success).toBe(false);
    expect(mail.safeParse({ mailer: 'carrier-pigeon' }).success).toBe(false);
    expect(mail.safeParse({ fromAddress: 'not-an-email' }).success).toBe(false);
    expect(mail.parse({ port: 465, encryption: 'ssl' })).toMatchObject({
      port: 465,
      encryption: 'ssl',
    });
  });

  it('TW-SET-014: out-of-range interface metrics are clamped, not rejected', () => {
    const b = SET_GROUP_SCHEMAS.branding;
    expect(b.parse({ fontScale: 500 }).fontScale).toBe(130);
    expect(b.parse({ fontScale: 0 }).fontScale).toBe(80);
    expect(b.parse({ uiOpacity: 10 }).uiOpacity).toBe(55);
    expect(b.parse({}).fontScale).toBe(100);
  });

  it('TW-SET-013: a malformed colour is refused (Reference silently stored it empty)', () => {
    const b = SET_GROUP_SCHEMAS.branding;
    expect(b.safeParse({ colors: { 'wa-deep': 'purple' } }).success).toBe(false);
    expect(b.parse({ colors: { 'wa-deep': '#7C3AED' } }).colors['wa-deep']).toBe('#7C3AED');
  });

  it('TW-SET-039: provider must be one of the six, visibility one of two', () => {
    const s = SET_GROUP_SCHEMAS.storage;
    expect(s.safeParse({ provider: 'dropbox' }).success).toBe(false);
    expect(s.safeParse({ visibility: 'secret' }).success).toBe(false);
    expect(s.parse({}).visibility).toBe('private');
  });
});

describe('patch body', () => {
  it('requires rowVersion, refuses unknown fields and unknown secret names', () => {
    const p = setPatchSchemaFor('mail');
    expect(p.safeParse({ values: {} }).success).toBe(false);
    expect(p.safeParse({ rowVersion: 0, values: { nope: 1 } }).success).toBe(false);
    expect(p.safeParse({ rowVersion: 0, secrets: { token: 'x' } }).success).toBe(false);
    expect(p.safeParse({ rowVersion: 0, secrets: { password: 'x' } }).success).toBe(true);
    expect(p.parse({ rowVersion: 3 })).toEqual({ rowVersion: 3, values: {}, secrets: {} });
  });

  it('a partial patch does not apply defaults to fields it leaves out', () => {
    const p = setPatchSchemaFor('general').parse({ rowVersion: 1, values: { appName: 'X' } });
    expect(Object.keys(p.values)).toEqual(['appName']);
  });

  it('only mail, storage, whatsapp and googleCalendar have secrets', () => {
    const withSecrets = SET_GROUPS.filter((g) => SET_SECRET_FIELDS[g].length > 0);
    expect(withSecrets.sort()).toEqual(['googleCalendar', 'mail', 'storage', 'whatsapp']);
  });
});

import { describe, expect, it } from 'vitest';
import { EXT_SHEETS_KEY_PATTERN } from '@crm/contracts';
import {
  bearerToken,
  generateSheetsKey,
  hashSheetsKey,
  looksLikeSheetsKey,
  maskedSheetsKey,
  sheetsKeySuffix,
} from '../../../src/modules/chrome-extension-sheets-addon/sheets-key.rules';

/** WD-EXT-001, 004: what a key looks like, what is stored of it, and how a bearer header is read. */
describe('sheets key', () => {
  it('has the WaDesk shape: wsn_live_ and 32 lowercase hex characters', () => {
    const key = generateSheetsKey();
    expect(key).toMatch(EXT_SHEETS_KEY_PATTERN);
    expect(key).toHaveLength('wsn_live_'.length + 32);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, generateSheetsKey));
    expect(seen.size).toBe(200);
  });

  it('is stored as a 64-character sha256, and the same key always gives the same hash', () => {
    const key = generateSheetsKey();
    expect(hashSheetsKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSheetsKey(key)).toBe(hashSheetsKey(key));
    expect(hashSheetsKey(key)).not.toContain(key.slice(9));
    expect(hashSheetsKey(key)).not.toBe(hashSheetsKey(generateSheetsKey()));
  });

  it('keeps the last 8 characters as a label and masks the rest', () => {
    const key = 'wsn_live_0123456789abcdef0123456789abcdef';
    expect(sheetsKeySuffix(key)).toBe('89abcdef');
    expect(maskedSheetsKey('89abcdef')).toBe('wsn_live_••••••••89abcdef');
  });

  it('recognises only its own shape before any lookup', () => {
    expect(looksLikeSheetsKey(generateSheetsKey())).toBe(true);
    for (const bad of [
      '',
      'wsn_live_',
      'wsn_live_ABCDEF0123456789ABCDEF0123456789', // upper case
      'wsn_live_0123456789abcdef0123456789abcde', // 31
      'wsn_live_0123456789abcdef0123456789abcdef0', // 33
      'wsk_' + 'A'.repeat(40), // a customer API key is not a Sheets key
      ' wsn_live_0123456789abcdef0123456789abcdef',
    ]) {
      expect(looksLikeSheetsKey(bad), bad).toBe(false);
    }
  });

  it('reads a bearer header and nothing else', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc  ')).toBe('abc');
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

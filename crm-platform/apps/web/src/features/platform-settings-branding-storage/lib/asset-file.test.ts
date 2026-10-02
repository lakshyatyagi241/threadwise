import { describe, expect, it } from 'vitest';
import { assetLimitKb, validateAssetFile } from './asset-file';

describe('brand file checks (TW-SET-010 rule 1)', () => {
  it('a 600 KB favicon is refused (limit 512 KB); a 900 KB SVG logo is fine', () => {
    expect(validateAssetFile('favicon', { name: 'a.ico', size: 600 * 1024 })).toBe('tooLarge');
    expect(validateAssetFile('favicon', { name: 'a.ico', size: 500 * 1024 })).toBeNull();
    expect(validateAssetFile('logo-dark', { name: 'logo.svg', size: 900 * 1024 })).toBeNull();
    expect(assetLimitKb('logo-paper')).toBe(1024);
  });
  it('an app icon takes png or webp only; a logo does not take ico', () => {
    expect(validateAssetFile('pwa-192', { name: 'i.svg', size: 10 })).toBe('wrongType');
    expect(validateAssetFile('ti-512', { name: 'i.webp', size: 10 })).toBeNull();
    expect(validateAssetFile('logo-paper', { name: 'a.ico', size: 10 })).toBe('wrongType');
  });
});

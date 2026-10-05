import { describe, expect, it } from 'vitest';
import { OFFICIAL_DOCS } from './social-docs';

describe('OFFICIAL_DOCS', () => {
  it('lists the four provider guides once each', () => {
    expect(OFFICIAL_DOCS.map((d) => d.id)).toEqual([
      'google',
      'facebook',
      'recaptchaAdmin',
      'recaptchaDocs',
    ]);
  });
  it('links only to https pages on the providers own sites', () => {
    const hosts = new Set(['developers.google.com', 'developers.facebook.com', 'www.google.com']);
    for (const d of OFFICIAL_DOCS) {
      const url = new URL(d.href);
      expect(url.protocol).toBe('https:');
      expect(hosts.has(url.hostname)).toBe(true);
    }
  });
});

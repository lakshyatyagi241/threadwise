import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  CONSENT_STORAGE_KEY,
  cookieValue,
  doNotTrack,
  parseConsent,
  readConsent,
  serializeConsent,
  writeConsent,
} from './cookie-consent';

describe('consent value', () => {
  it('always records the strictly-necessary category as on, with the time of the decision', () => {
    const json = serializeConsent({ analytics: true, marketing: false }, 1_700_000_000_000);
    expect(JSON.parse(json)).toEqual({
      necessary: true,
      analytics: true,
      marketing: false,
      ts: 1_700_000_000,
    });
  });

  it('round-trips and ignores anything that is not a decision', () => {
    const json = serializeConsent({ analytics: false, marketing: true }, 5000);
    expect(parseConsent(json)).toEqual({
      necessary: true,
      analytics: false,
      marketing: true,
      ts: 5,
    });
    for (const bad of [
      null,
      '',
      'nope',
      '[]',
      '{"analytics":1,"marketing":true}',
      '{"analytics":true}',
    ]) {
      expect(parseConsent(bad), String(bad)).toBeNull();
    }
  });

  it('reads one cookie out of a cookie header, decoding it', () => {
    expect(
      cookieValue('a=1; crm_cookie_consent=%7B%22x%22%3A1%7D; b=2', 'crm_cookie_consent'),
    ).toBe('{"x":1}');
    expect(cookieValue('a=1', 'crm_cookie_consent')).toBeNull();
    expect(cookieValue('crm_cookie_consent=%E0%A4%A', 'crm_cookie_consent')).toBeNull();
  });

  it('treats "Do Not Track" and Global Privacy Control as a request to decline', () => {
    expect(doNotTrack({ doNotTrack: '1' })).toBe(true);
    expect(doNotTrack({ globalPrivacyControl: true })).toBe(true);
    expect(doNotTrack({ doNotTrack: '0' })).toBe(false);
    expect(doNotTrack({ doNotTrack: null, globalPrivacyControl: false })).toBe(false);
    expect(doNotTrack({})).toBe(false);
  });
});

describe('remembering the choice in the browser', () => {
  let cookie = '';
  const storage = new Map<string, string>();

  beforeEach(() => {
    cookie = '';
    storage.clear();
    vi.stubGlobal('document', {
      get cookie() {
        return cookie;
      },
      set cookie(v: string) {
        // Keep only the name=value part, like a browser's cookie jar read-back.
        cookie = v.split(';')[0]!;
      },
    });
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes the choice to both a cookie and local storage, and reads it back', () => {
    expect(readConsent()).toBeNull();
    const saved = writeConsent({ analytics: true, marketing: false }, 10_000);
    expect(saved).toMatchObject({ analytics: true, marketing: false, necessary: true });
    expect(cookie.startsWith(`${CONSENT_COOKIE}=`)).toBe(true);
    expect(storage.has(CONSENT_STORAGE_KEY)).toBe(true);
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false });
  });

  it('still remembers when the cookie is gone but storage survives', () => {
    writeConsent({ analytics: false, marketing: false });
    cookie = '';
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
  });

  it('lasts a year', () => {
    expect(CONSENT_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});

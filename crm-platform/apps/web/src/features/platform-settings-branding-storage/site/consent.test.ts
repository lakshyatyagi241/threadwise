import { describe, expect, it } from 'vitest';
import {
  CONSENT_COOKIE,
  DENIED,
  choice,
  consentCookie,
  effectiveConsent,
  firstVisit,
  parseConsent,
  readConsent,
} from './consent';

describe('cookie consent (WD-SET-030)', () => {
  it('Accept All stores analytics and marketing true, Reject stores both false', () => {
    expect(choice(true, true, 5000)).toEqual({
      necessary: true,
      analytics: true,
      marketing: true,
      ts: 5,
    });
    expect(choice(false, false, 0)).toMatchObject({ analytics: false, marketing: false });
  });

  it('the cookie lasts a year, is path /, SameSite Lax, Secure on https, and round-trips', () => {
    const c = choice(true, false, 1_000_000);
    const line = consentCookie(c, true);
    expect(line).toContain(`${CONSENT_COOKIE}=`);
    expect(line).toContain('max-age=31536000');
    expect(line).toContain('path=/');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Secure');
    expect(consentCookie(c, false)).not.toContain('Secure');
    const value = line.split(';')[0]!;
    expect(readConsent(`a=1; ${value}; b=2`)).toEqual(c);
  });

  it('garbage or a missing cookie reads as no choice, never as an error', () => {
    expect(parseConsent('%7Bnot json')).toBeNull();
    expect(parseConsent('"string"')).toBeNull();
    expect(parseConsent('')).toBeNull();
    expect(readConsent('other=1')).toBeNull();
  });

  it('a hand-edited cookie cannot grant "necessary: false" or non-boolean flags', () => {
    const forged = encodeURIComponent(
      JSON.stringify({ necessary: false, analytics: 'yes', marketing: 1 }),
    );
    expect(parseConsent(forged)).toMatchObject({
      necessary: true,
      analytics: false,
      marketing: false,
    });
  });

  it('with the banner off everything is allowed; with it on nothing is until the visitor decides', () => {
    expect(effectiveConsent(false, null)).toMatchObject({ analytics: true, marketing: true });
    expect(effectiveConsent(true, null)).toEqual(DENIED);
    expect(effectiveConsent(true, choice(true, false))).toMatchObject({
      analytics: true,
      marketing: false,
    });
  });

  it('first visit: the bottom bar by default, a modal for the modal style, nothing after a choice or with the banner off', () => {
    const base = {
      bannerEnabled: true,
      stored: null,
      respectDoNotTrack: true,
      doNotTrack: false,
      style: 'bottom-bar',
    };
    expect(firstVisit(base)).toBe('bar');
    expect(firstVisit({ ...base, style: 'top-bar' })).toBe('bar');
    expect(firstVisit({ ...base, style: 'modal' })).toBe('modal');
    expect(firstVisit({ ...base, stored: choice(true, true) })).toBe('none');
    expect(firstVisit({ ...base, bannerEnabled: false })).toBe('none');
  });

  it('Do-Not-Track rejects without any UI, but only when the platform respects it', () => {
    const base = {
      bannerEnabled: true,
      stored: null,
      respectDoNotTrack: true,
      doNotTrack: true,
      style: 'modal',
    };
    expect(firstVisit(base)).toBe('reject');
    expect(firstVisit({ ...base, respectDoNotTrack: false })).toBe('modal');
  });
});

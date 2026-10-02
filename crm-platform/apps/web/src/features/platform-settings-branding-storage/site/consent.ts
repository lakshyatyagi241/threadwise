/**
 * The visitor's cookie choice (WD-SET-030). A first-party cookie, one year, readable by the page script: it carries only
 * the three category flags and a timestamp. Pure functions; the banner component and the tracker loader share them.
 */
export const CONSENT_COOKIE = 'crm_cookie_consent';
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export interface Consent {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** Unix seconds when the choice was made. */
  ts: number;
}

export const DENIED: Consent = { necessary: true, analytics: false, marketing: false, ts: 0 };

export const choice = (analytics: boolean, marketing: boolean, now = Date.now()): Consent => ({
  necessary: true,
  analytics,
  marketing,
  ts: Math.floor(now / 1000),
});

/** The stored choice, or null for no cookie or a cookie that is not ours (never throws on garbage). */
export function parseConsent(raw: string | null | undefined): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (typeof v !== 'object' || v === null) return null;
    return {
      necessary: true,
      analytics: v.analytics === true,
      marketing: v.marketing === true,
      ts: typeof v.ts === 'number' ? v.ts : 0,
    };
  } catch {
    return null;
  }
}

/** The `Set-Cookie`-style string for `document.cookie`: path /, one year, SameSite Lax, Secure on https. */
export function consentCookie(c: Consent, secure: boolean): string {
  const value = encodeURIComponent(JSON.stringify(c));
  return `${CONSENT_COOKIE}=${value}; path=/; max-age=${YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Reads the consent out of a `document.cookie` string. */
export function readConsent(cookieHeader: string): Consent | null {
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === CONSENT_COOKIE)
      return parseConsent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * What the trackers may do. With the banner switched off there is nothing to ask, so everything is allowed (as in WaDesk);
 * otherwise the stored choice, and nothing but the necessary category until the visitor decides.
 */
export function effectiveConsent(bannerEnabled: boolean, stored: Consent | null): Consent {
  if (!bannerEnabled) return choice(true, true, 0);
  return stored ?? DENIED;
}

export type FirstVisit = 'none' | 'reject' | 'bar' | 'modal';

/**
 * What to do on a page load (rule 2): nothing when the banner is off or a choice exists; an implicit reject (no UI) when
 * the browser says Do-Not-Track and the platform respects it; otherwise the configured style.
 */
export function firstVisit(o: {
  bannerEnabled: boolean;
  stored: Consent | null;
  respectDoNotTrack: boolean;
  doNotTrack: boolean;
  style: string;
}): FirstVisit {
  if (!o.bannerEnabled || o.stored) return 'none';
  if (o.respectDoNotTrack && o.doNotTrack) return 'reject';
  return o.style === 'modal' ? 'modal' : 'bar';
}

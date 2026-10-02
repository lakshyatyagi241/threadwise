/**
 * Cookie-consent choice of a guest visitor (kept in this browser only). The same JSON is written to
 * `localStorage` and to a first-party cookie, so a server-rendered page can read it before it decides which
 * optional scripts to include. Nothing here loads a script by itself: the strictly-necessary category is always
 * on, and the optional categories only record what the visitor allowed.
 */

export const CONSENT_COOKIE = 'crm_cookie_consent';
export const CONSENT_STORAGE_KEY = 'crm.cookie-consent';
/** One year, in seconds. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export interface ConsentChoice {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** Unix seconds when the visitor decided. */
  ts: number;
}

export const ACCEPT_ALL = { analytics: true, marketing: true } as const;
export const DECLINE_OPTIONAL = { analytics: false, marketing: false } as const;

/** Reads a stored choice. Anything that is not a well-formed choice counts as "not decided yet". */
export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.analytics !== 'boolean' || typeof o.marketing !== 'boolean') return null;
    return {
      necessary: true,
      analytics: o.analytics,
      marketing: o.marketing,
      ts: typeof o.ts === 'number' ? o.ts : 0,
    };
  } catch {
    return null;
  }
}

export function serializeConsent(
  choice: Pick<ConsentChoice, 'analytics' | 'marketing'>,
  nowMs: number = Date.now(),
): string {
  const full: ConsentChoice = {
    necessary: true,
    analytics: choice.analytics,
    marketing: choice.marketing,
    ts: Math.floor(nowMs / 1000),
  };
  return JSON.stringify(full);
}

/** The value of one cookie in a `document.cookie` string. */
export function cookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Fired on `window` after a choice is stored, so every part of the page showing it can update. */
export const CONSENT_CHANGE_EVENT = 'crm:cookie-consent-changed';

/**
 * The stored choice as text (cookie first, then storage), or null. A stable primitive, so it works as an
 * external-store snapshot.
 */
export function readConsentRaw(): string | null {
  if (typeof document === 'undefined') return null;
  const fromCookie = cookieValue(document.cookie, CONSENT_COOKIE);
  if (parseConsent(fromCookie)) return fromCookie;
  try {
    const fromStorage = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return parseConsent(fromStorage) ? fromStorage : null;
  } catch {
    return null;
  }
}

/** The stored choice from the cookie, else from storage; null when the visitor has not decided. */
export function readConsent(): ConsentChoice | null {
  return parseConsent(readConsentRaw());
}

/** Stores the choice in both places. Either may be blocked; the other still holds it. */
export function writeConsent(
  choice: Pick<ConsentChoice, 'analytics' | 'marketing'>,
  nowMs: number = Date.now(),
): ConsentChoice {
  const json = serializeConsent(choice, nowMs);
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(json)}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    /* cookies blocked: storage below still remembers it */
  }
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, json);
  } catch {
    /* storage blocked: the cookie still remembers it */
  }
  try {
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
  } catch {
    /* no event support: the next render reads the stored value anyway */
  }
  return parseConsent(json) as ConsentChoice;
}

/** True when the browser asks not to be tracked ("Do Not Track" or Global Privacy Control). */
export function doNotTrack(nav: {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}): boolean {
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/** Event that asks the banner to open its preferences (a "Cookie settings" link elsewhere on the page). */
export const OPEN_PREFERENCES_EVENT = 'crm:cookie-preferences';

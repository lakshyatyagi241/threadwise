/**
 * Referral code capture (TW-AUTH-005). A `?ref=` on any page is remembered for 30 days in an httpOnly cookie
 * that the Next proxy sets on the server (`src/proxy.ts`), so it survives clicks around the site before the
 * visitor reaches sign-up. Page code cannot read the cookie; the sign-up page reads it on the server and the
 * sign-in route clears it once an account exists.
 */

export const REFERRAL_COOKIE = 'crm_ref';
/** 30 days, in seconds. */
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;
/** Longest code the sign-up contract accepts. */
export const REFERRAL_MAX_LENGTH = 16;

/** Upper-case letters and digits only, at most 16: what a person typing or pasting a code ends up with. */
export function sanitizeReferral(raw: string | null | undefined): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, REFERRAL_MAX_LENGTH);
}

/**
 * The code carried by a `?ref=` value, or '' when it is unusable. Unlike typing, a link that carries more
 * than 16 characters is a typo or tampering, so it is dropped rather than shortened to a different code.
 */
export function referralFromParam(raw: string | null | undefined): string {
  const code = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length > 0 && code.length <= REFERRAL_MAX_LENGTH ? code : '';
}

/**
 * A sign-up body with the remembered code filled in when the form sent none. Reference reads the box first and falls
 * back to the cookie, so a box left empty still credits the link that brought the visitor.
 */
export function withReferralFallback<T extends Record<string, unknown>>(
  body: T,
  cookieValue: string | null | undefined,
): T {
  const typed = typeof body.referralCode === 'string' ? body.referralCode.trim() : '';
  const remembered = referralFromParam(cookieValue);
  return typed || !remembered ? body : { ...body, referralCode: remembered };
}

/** The cookie to store for a visit, or null when the visit carries no usable code. */
export function referralCookieFor(
  raw: string | null | undefined,
  secure: boolean,
): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge: number;
  };
} | null {
  const value = referralFromParam(raw);
  if (!value) return null;
  return {
    name: REFERRAL_COOKIE,
    value,
    options: { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: REFERRAL_MAX_AGE },
  };
}

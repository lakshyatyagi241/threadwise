/** Referral code capture (WD-AUTH-005): `?ref=` is remembered for 30 days in a cookie, set from the page. */

export const REFERRAL_COOKIE = 'crm_ref';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Upper-case letters and digits only, at most 16 (matches the sign-up contract). */
export function sanitizeReferral(raw: string | null | undefined): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

export function readReferralFromCookie(cookieHeader: string): string {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFERRAL_COOKIE) return sanitizeReferral(decodeURIComponent(rest.join('=')));
  }
  return '';
}

export function referralCookie(code: string): string {
  return `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Max-Age=${THIRTY_DAYS}; Path=/; SameSite=Lax`;
}

export function clearedReferralCookie(): string {
  return `${REFERRAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Browser side: remembers a `?ref=` value. No-op without a document or a usable code. */
export function rememberReferral(raw: string | null | undefined): string {
  const code = sanitizeReferral(raw);
  if (code && typeof document !== 'undefined') {
    try {
      document.cookie = referralCookie(code);
    } catch {
      /* cookies blocked: the code still prefills the form for this visit */
    }
  }
  return code;
}

export function currentReferral(): string {
  if (typeof document === 'undefined') return '';
  try {
    return readReferralFromCookie(document.cookie);
  } catch {
    return '';
  }
}

export function forgetReferral(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = clearedReferralCookie();
  } catch {
    /* nothing to clear */
  }
}

import { normaliseFormOrigin } from '@crm/contracts';

/**
 * The Share tab's pure parts. The API hands out the hosted address and both snippets (`FormDetail.share`), so this file does not build
 * them: it checks the allowed-origins list the same way the server does, and holds the redirect and frame-message rules the page uses.
 */

export type OriginIssue = 'empty' | 'invalid' | 'duplicate';

/**
 * One entry of the allowed-origins list (spec section 7.3), normalised by the contract's own function so the screen and the API
 * can never disagree: an exact origin or `https://*.example.com`; never a bare `*`, never a path, plain http for localhost only.
 */
export function checkOrigin(
  raw: string,
  existing: readonly string[] = [],
): { ok: true; value: string } | { ok: false; issue: OriginIssue } {
  if (!raw.trim()) return { ok: false, issue: 'empty' };
  const value = normaliseFormOrigin(raw);
  if (!value) return { ok: false, issue: 'invalid' };
  if (existing.includes(value)) return { ok: false, issue: 'duplicate' };
  return { ok: true, value };
}

/** Where a visitor goes after submit: `https:` only, so a form can never send them to `javascript:` or `data:`. */
export function safeRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The loader's message from the framed page to the host page (child to parent only; the child never listens). */
export type FrameMessage =
  | { source: 'forms'; type: 'resize'; key: string; height: number }
  | { source: 'forms'; type: 'submitted'; key: string }
  | { source: 'forms'; type: 'redirect'; key: string; url: string };

export function resizeMessage(key: string, height: number): FrameMessage {
  return { source: 'forms', type: 'resize', key, height: Math.max(0, Math.ceil(height)) };
}

/** The address as a QR code's payload: the hosted page, with a tracking tag the owner can read in the submission's attribution. */
export function qrTarget(hostedUrl: string): string {
  try {
    const u = new URL(hostedUrl);
    u.searchParams.set('utm_source', 'qr');
    return u.toString();
  } catch {
    return hostedUrl;
  }
}

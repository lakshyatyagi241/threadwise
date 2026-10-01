import { randomBytes } from 'node:crypto';

/** Lowercase, ascii, dash-separated. Empty input falls back to "workspace". */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'workspace';
}

export const slugWithSuffix = (base: string): string =>
  `${base.slice(0, 32)}-${randomBytes(3).toString('hex')}`;

/** "+91 •••• ••21": country prefix visible, last two digits visible. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const tail = digits.slice(-2);
  // Calling codes are 1-3 digits; two cover most countries without exposing national digits.
  const prefixLen = Math.min(2, Math.max(1, digits.length - 8));
  return `+${digits.slice(0, prefixLen)} •••• ••${tail}`;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** "Priya Sharma" for "priya.sharma@acme.com" workspace-name suggestions. */
export function suggestWorkspaceName(email: string): string {
  const local = email.split('@')[0] ?? 'my';
  const words = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `${words.join(' ') || 'My'}'s workspace`;
}

/** True for an IANA zone id this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Only relative, same-site paths may be used as a post-login destination. */
export function safeRelativePath(path: string | null | undefined): string | null {
  if (!path) return null;
  // "//evil.com" and "/\evil.com" are protocol-relative / backslash tricks.
  return /^\/(?![/\\])/.test(path) ? path : null;
}

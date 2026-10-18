/** What a Link button can open; mirrors the "Opens" select in the Simple builder. */
export type CtaKind = 'url' | 'phone' | 'email';

export type CtaLinkProblem = 'url' | 'phone' | 'email';

const EMAIL = /^[^\s@{}]+@[^\s@{}]+\.[^\s@.{}]{2,}$/;
const PHONE = /^\+?[\d\s().-]+$/;

/** A merge token such as {{first_name}} is filled in at send time, so the shape can only be checked on the literal text. */
const hasToken = (v: string) => /\{\{[^}]+\}\}/.test(v);

/**
 * The problem with a button's target for the kind it opens, or null when it is fine. An empty value is not reported here (the
 * "give the button a name and a link" check owns that); this only says the value is the wrong shape for the chosen kind.
 */
export function ctaLinkProblem(kind: string, raw: unknown): CtaLinkProblem | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || hasToken(v)) return null;
  if (kind === 'email') return EMAIL.test(v) ? null : 'email';
  if (kind === 'phone') {
    const digits = v.replace(/\D/g, '');
    return PHONE.test(v) && digits.length >= 7 && digits.length <= 15 ? null : 'phone';
  }
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.')
      ? null
      : 'url';
  } catch {
    return 'url';
  }
}

/**
 * The last workspace this browser signed in to (`crm_org`), so the sign-in form can prefill it. It is not a
 * credential. The sign-in route sets it when the request carried a slug; for sign-up and social sign-in the slug
 * is only known from the response, so the page sets the same cookie itself.
 */

export const ORG_COOKIE_NAME = 'crm_org';
const ONE_YEAR = 60 * 60 * 24 * 365;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

/** The Set-Cookie string for a slug, or null when it is not a valid workspace slug. */
export function orgCookie(slug: string | null | undefined): string | null {
  const value = (slug ?? '').trim();
  return SLUG.test(value)
    ? `${ORG_COOKIE_NAME}=${value}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax`
    : null;
}

/** Browser side. A no-op without a document, with cookies blocked, or with an invalid slug. */
export function rememberOrg(slug: string | null | undefined): void {
  const cookie = orgCookie(slug);
  if (!cookie || typeof document === 'undefined') return;
  try {
    document.cookie = cookie;
  } catch {
    /* cookies blocked: the next sign-in simply starts with an empty workspace field */
  }
}

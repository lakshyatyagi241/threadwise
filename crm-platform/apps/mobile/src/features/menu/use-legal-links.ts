import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import type { LegalSlug } from '@crm/contracts';
import { legalSlugOf, resolveLegalUrl } from '@/lib/links/legal-url';
import { fetchLegalLinks } from './links-api';

/** Same key as the sign-up screen's read of the platform settings, so one request serves both. */
const registrationConfigKey = ['auth', 'registration-config'] as const;
const FIVE_MINUTES = 5 * 60_000;

/** Where a policy opens: the app's own screen for it, an outside address, or nowhere (an address the app may not open). */
export interface LegalTarget {
  slug: LegalSlug | null;
  url: string | null;
}

function targetOf(value: string | null | undefined, fallback: LegalSlug): LegalTarget {
  const options = { allowHttp: env.variant === 'development' };
  // Nothing set (or not read yet): the platform's own document, which is public and always there.
  if (!(value ?? '').trim()) return { slug: fallback, url: null };
  const slug = legalSlugOf(value, env.webUrl);
  if (slug) return { slug, url: null };
  return { slug: null, url: resolveLegalUrl(value, env.webUrl, options) };
}

/**
 * Where the Terms of Use and the Privacy Policy open. The platform's own documents (a blank address, or the site path
 * `/legal/terms`) open on the app's own screen, read from the public page; an address an administrator pointed elsewhere opens in the
 * browser, only when it is `https` (plain `http` only in a development build); anything else (a `javascript:` value, a path with no
 * web address to join it to) gives null for both, and the row stays faded.
 */
export function useLegalLinks(): { terms: LegalTarget; privacy: LegalTarget } {
  const config = useQuery({
    queryKey: registrationConfigKey,
    queryFn: ({ signal }) => fetchLegalLinks(signal),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  return {
    terms: targetOf(config.data?.links.terms, 'terms'),
    privacy: targetOf(config.data?.links.privacy, 'privacy'),
  };
}

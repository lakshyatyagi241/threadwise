import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { resolveLegalUrl } from '@/lib/links/legal-url';
import { fetchLegalLinks } from './links-api';

/** Same key as the sign-up screen's read of the platform settings, so one request serves both. */
const registrationConfigKey = ['auth', 'registration-config'] as const;
const FIVE_MINUTES = 5 * 60_000;

/**
 * The addresses of the Terms of Use and the Privacy Policy, each null when there is none the app may open: the administrator set a
 * site path and the app does not know the web address (`EXPO_PUBLIC_WEB_URL`), or the address is not `https` (plain `http` is allowed
 * only in a development build). While it loads, or when the call fails, both are null.
 */
export function useLegalLinks(): { terms: string | null; privacy: string | null } {
  const config = useQuery({
    queryKey: registrationConfigKey,
    queryFn: ({ signal }) => fetchLegalLinks(signal),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  const options = { allowHttp: env.variant === 'development' };
  return {
    terms: resolveLegalUrl(config.data?.links.terms, env.webUrl, options),
    privacy: resolveLegalUrl(config.data?.links.privacy, env.webUrl, options),
  };
}

/** The web app's Help center page (`/help`), or null when the app does not know the web address. It opens in the browser. */
export function helpCenterUrl(): string | null {
  return resolveLegalUrl('/help', env.webUrl, { allowHttp: env.variant === 'development' });
}

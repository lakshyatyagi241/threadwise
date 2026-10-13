import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { resolveLegalUrl } from '@/lib/links/legal-url';
import { fetchLegalLinks } from './links-api';

/** Same key as the sign-up screen's read of the platform settings, so one request serves both. */
const registrationConfigKey = ['auth', 'registration-config'] as const;
const FIVE_MINUTES = 5 * 60_000;

/**
 * The address of the privacy policy, or null when there is none the app may open: the administrator set a site path and the app
 * does not know the web address (`EXPO_PUBLIC_WEB_URL`), or the address is not `https` (plain `http` is allowed only in a
 * development build). While it loads, or when the call fails, the Menu simply has no such row.
 */
export function usePrivacyLink(): string | null {
  const config = useQuery({
    queryKey: registrationConfigKey,
    queryFn: ({ signal }) => fetchLegalLinks(signal),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  return resolveLegalUrl(config.data?.links.privacy, env.webUrl, {
    allowHttp: env.variant === 'development',
  });
}

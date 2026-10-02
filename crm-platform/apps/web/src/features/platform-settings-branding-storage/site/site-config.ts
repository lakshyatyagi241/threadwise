import 'server-only';
import { cache } from 'react';
import { publicSiteConfigSchema, type PublicSiteConfig } from '@crm/contracts';
import { apiBase } from '@/lib/auth/server';

/**
 * The public settings for this request (brand, SEO, theme, banner, tracker ids), or null when the API is unreachable: a
 * page must render without them, never fail because of them. Cached for 30 seconds by Next and once per request by React.
 */
export const getSiteConfig = cache(async (): Promise<PublicSiteConfig | null> => {
  try {
    const res = await fetch(`${apiBase()}/v2/public/site-config`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const parsed = publicSiteConfigSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

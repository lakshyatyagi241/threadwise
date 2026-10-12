import type { MarketAppKind } from '@crm/contracts';

/** Every address of the workspace Marketplace screens, in one place so links and tests agree. */
export const PLANS_PATH = '/account/plans';

export const mktRoutes = {
  home: '/marketplace',
  apps: '/marketplace/apps',
  integrations: '/marketplace/integrations',
  addons: '/marketplace/addons',
  installed: '/marketplace/installed',
  requests: '/marketplace/requests',
  app: (slug: string) => `/marketplace/app/${slug}`,
  install: (slug: string) => `/marketplace/app/${slug}/install`,
  manage: (id: string) => `/marketplace/installed/${id}`,
  browse: (kind: MarketAppKind) =>
    kind === 'mini_app' ? '/marketplace/apps' : '/marketplace/integrations',
} as const;

/**
 * An upgrade address the API sent. Only a same-site path is followed (`/account/plans`); anything else (an absolute address, a
 * protocol-relative one, a script) falls back to the plans page, so a response can never point the browser elsewhere.
 */
export function safeInternalPath(
  path: string | null | undefined,
  fallback: string = PLANS_PATH,
): string {
  const p = path?.trim();
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /\s/.test(p))
    return fallback;
  return p;
}

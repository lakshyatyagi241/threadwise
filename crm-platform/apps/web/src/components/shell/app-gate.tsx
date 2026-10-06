'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { EmptyState } from '@crm/ui';
import { routeGateFor } from './nav-model';

/** One app-owned screen, derived from a menu entry that declares `gates.app` (see `features/_registry/types.ts`). */
export interface AppRouteGate {
  /** The menu entry's address; the longest one that covers the current path decides. */
  href: string;
  /** The plan feature key the Marketplace app grants. */
  feature: string;
  /** The menu entry's label key, which names the app on the screen below. */
  labelKey: string;
}

/** Whether the path belongs to an app the workspace does not have. `enabled` null (entitlements unknown) closes nothing. */
export function closedAppGate(
  pathname: string,
  gates: readonly AppRouteGate[],
  enabled: readonly string[] | null,
): AppRouteGate | null {
  if (!enabled) return null;
  const gate = routeGateFor(gates, pathname);
  return gate && !enabled.includes(gate.feature) ? gate : null;
}

/**
 * Closes the routes of a Marketplace app the workspace has not bought or been given. The menu entry is already gone
 * (`gates.app`); this covers the other way in, an address typed, bookmarked or followed from an old link. The page itself is
 * never mounted, so nothing of the app shows and none of its requests fire. The API stays the authority: it refuses the app's
 * routes on its own (`PLAN_FEATURE_LOCKED`), this only keeps the person from landing on an error.
 */
export function AppGate({
  gates,
  enabled,
  marketplaceHref,
  children,
}: {
  gates: readonly AppRouteGate[];
  enabled: readonly string[] | null;
  /** Where the Marketplace lists mini apps, or null when this person or plan cannot open it. */
  marketplaceHref: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const closed = closedAppGate(pathname, gates, enabled);
  if (!closed) return <>{children}</>;
  return <AppUnavailable labelKey={closed.labelKey} marketplaceHref={marketplaceHref} />;
}

function AppUnavailable({
  labelKey,
  marketplaceHref,
}: {
  labelKey: string;
  marketplaceHref: string | null;
}) {
  const t = useTranslations();
  const app = t(labelKey);
  const link =
    'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition hover:opacity-90';
  return (
    <div className="mx-auto max-w-2xl py-10" data-testid="app-unavailable">
      <EmptyState
        title={t('shell.appGate.title', { app })}
        message={
          marketplaceHref
            ? t('shell.appGate.body', { app })
            : t('shell.appGate.bodyNoMarketplace', { app })
        }
        actions={
          <>
            {marketplaceHref && (
              <Link href={marketplaceHref} className={`${link} bg-primary text-primary-foreground`}>
                {t('shell.appGate.browse')}
              </Link>
            )}
            <Link href="/dashboard" className={`${link} border border-border hover:bg-muted`}>
              {t('shell.appGate.back')}
            </Link>
          </>
        }
      />
    </div>
  );
}

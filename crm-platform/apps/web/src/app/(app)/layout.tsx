import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountBanners } from '@/features/auth-registration-security/account/account-banners';
import { AccountGate } from '@/features/auth-registration-security/account/account-gate';
import { WorkspaceSwitcher } from '@/features/auth-registration-security/account/workspace-switcher';
import { ImpersonationBanner } from '@/features/workspaces-teams-tenancy';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { TrialBar } from '@/features/plans-subscriptions-trials/components/trial-bar';
import { fetchEnabledFeatures } from '@/features/plans-subscriptions-trials/server';
import { HelpProvider } from '@/features/help-center';
import { helpFor } from '@/features/help-center/view';
import { AppGate, type AppRouteGate } from '@/components/shell/app-gate';
import { InboxNavCounts } from '@/features/team-inbox-conversations';
import { WalletAppShell } from '@/features/wallet-message-billing';
import { LiveNotifications, NotificationBell } from '@/features/notifications-activity-audit';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { NAV } from '@/features/_registry/nav.generated';
import { MENU_PLANNED_NAV } from '@/features/_registry/planned';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { THEME_COOKIE } from '@/lib/auth/cookies';
import { getSession, signedOutTarget } from '@/lib/auth/server';
import { RealtimeProvider } from '@/lib/realtime';

/**
 * Customer workspace shell. Guards the session, hands the whole session
 * (user, org, permissions, flags) to client components, gates unverified,
 * suspended and unfinished accounts, and shapes the menu from the caller's
 * real permissions.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, expired, idleMinutes } = await getSession();
  if (!session) redirect(await signedOutTarget(expired, idleMinutes));

  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  // The plan's features lock the menu entries that need one and drive the paywall sheet; unknown (null) locks nothing.
  const enabledFeatures = await fetchEnabledFeatures();
  const capabilities = {
    ...CAPABILITIES_UNKNOWN,
    permissions: new Set(Object.keys(session.permissions)),
    planFeatures: enabledFeatures,
  };
  // The docs this person may see in Help (gated like the menu); the page-level tip and every HelpTip read this index.
  const help = helpFor(capabilities, await getLocale());
  const paywallGates = NAV.filter((n) => n.gates?.planFeature).map((n) => ({
    href: n.href,
    feature: n.gates!.planFeature!,
  }));
  // A Marketplace app's screens are closed (not paywalled) while the workspace does not have the app; see `gates.app`.
  const appGates: AppRouteGate[] = NAV.filter((n) => n.gates?.app).map((n) => ({
    href: n.href,
    feature: n.gates!.app!,
    labelKey: n.labelKey,
  }));
  // Where the "not part of your workspace" screen can send a person: only when they may open the Marketplace.
  const marketplaceHref =
    capabilities.permissions.has('market.apps.read') && enabledFeatures?.has('marketplace')
      ? '/marketplace/apps'
      : null;

  return (
    <SessionProvider session={session}>
      {/* One socket per signed-in session; the key starts a fresh one (and a fresh ticket) when the person or workspace changes.
          The address is read here, on the server, so it can be set per deployment without rebuilding. */}
      <RealtimeProvider
        key={`${session.org.id}:${session.user.id}`}
        url={process.env.REALTIME_URL ?? process.env.NEXT_PUBLIC_REALTIME_URL}
      >
        {/* Bell, toast, ping, desktop alert and tab-title badge on every page, from the socket above (no second connection). */}
        <LiveNotifications />
        <HelpProvider entries={help.entries}>
          {/* The Inbox entry's unread number in the menu, on every page (read from the cache the Inbox and the live socket keep). */}
          <InboxNavCounts enabled={capabilities.permissions.has('inbox.conversation.read')}>
            <WalletAppShell
              user={{
                fullName: session.user.displayName ?? session.user.fullName,
                email: session.user.email,
                avatarUrl: session.user.avatarUrl,
              }}
              nav={resolveNav(NAV, capabilities, { planned: MENU_PLANNED_NAV })}
              settings={resolveSettings(SETTINGS, capabilities, { planned: PLANNED_SETTINGS })}
              theme={theme}
              navFooter={<WorkspaceSwitcher />}
              banners={
                <>
                  {/* An operator acting as the owner (TW-WSP-033): non-dismissible, first thing under the top bar. */}
                  <ImpersonationBanner key="impersonation" />
                  <TrialBar />
                  <AccountBanners key="banners" />
                </>
              }
              bell={<NotificationBell key="bell" />}
            >
              <AccountGate>
                <AppGate
                  gates={appGates}
                  enabled={enabledFeatures ? [...enabledFeatures] : null}
                  marketplaceHref={marketplaceHref}
                >
                  {children}
                </AppGate>
              </AccountGate>
              <PlanPaywall
                gates={paywallGates}
                enabled={enabledFeatures ? [...enabledFeatures] : null}
              />
            </WalletAppShell>
          </InboxNavCounts>
        </HelpProvider>
      </RealtimeProvider>
    </SessionProvider>
  );
}

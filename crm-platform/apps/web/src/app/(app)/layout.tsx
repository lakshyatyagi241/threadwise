import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { AccountBanners } from '@/features/auth-registration-security/account/account-banners';
import { AccountGate } from '@/features/auth-registration-security/account/account-gate';
import { WorkspaceSwitcher } from '@/features/auth-registration-security/account/workspace-switcher';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { TrialBar } from '@/features/plans-subscriptions-trials/components/trial-bar';
import { fetchEnabledFeatures } from '@/features/plans-subscriptions-trials/server';
import { NotificationBell } from '@/features/notifications-activity-audit';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { NAV } from '@/features/_registry/nav.generated';
import { PLANNED_NAV } from '@/features/_registry/planned';
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
  const paywallGates = NAV.filter((n) => n.gates?.planFeature).map((n) => ({
    href: n.href,
    feature: n.gates!.planFeature!,
  }));

  return (
    <SessionProvider session={session}>
      {/* One socket per signed-in session; the key starts a fresh one (and a fresh ticket) when the person or workspace changes.
          The address is read here, on the server, so it can be set per deployment without rebuilding. */}
      <RealtimeProvider
        key={`${session.org.id}:${session.user.id}`}
        url={process.env.REALTIME_URL ?? process.env.NEXT_PUBLIC_REALTIME_URL}
      >
        <AppShell
          user={{
            fullName: session.user.displayName ?? session.user.fullName,
            email: session.user.email,
            avatarUrl: session.user.avatarUrl,
          }}
          nav={resolveNav(NAV, capabilities, { planned: PLANNED_NAV })}
          settings={resolveSettings(SETTINGS, capabilities, { planned: PLANNED_SETTINGS })}
          theme={theme}
          navFooter={<WorkspaceSwitcher />}
          banners={
            <>
              <TrialBar />
              <AccountBanners key="banners" />
            </>
          }
          bell={<NotificationBell key="bell" />}
        >
          <AccountGate>{children}</AccountGate>
          <PlanPaywall
            gates={paywallGates}
            enabled={enabledFeatures ? [...enabledFeatures] : null}
          />
        </AppShell>
      </RealtimeProvider>
    </SessionProvider>
  );
}

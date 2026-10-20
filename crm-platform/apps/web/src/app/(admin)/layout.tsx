import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { resolveTimezone } from '@crm/contracts';
import { getConsoleCounts } from '@/features/admin-console-shell/console-counts';
import { ConsoleShell } from '@/features/admin-console-shell/console-shell';
import {
  CONSOLE_SIDEBAR_COOKIE,
  parseSidebarState,
} from '@/features/admin-console-shell/sidebar-state';
import {
  operatorLoginPath,
  safeConsolePath,
} from '@/features/auth-registration-security/platform/lib/next-path';
import { IpBlockedView } from '@/features/auth-registration-security/platform/ui/ip-blocked-view';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { getOperatorSession, requestPath } from '@/lib/auth/server';

const OPERATOR_HOME = '/admin';

/** Platform-operator console: a separate identity pool from workspace staff. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session, expired, blockedIp, idleMinutes } = await getOperatorSession();
  if (blockedIp !== undefined) {
    // A hard navigation from a refused address lands here, not on a silent bounce to the login page.
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <IpBlockedView ip={blockedIp || null} />
      </main>
    );
  }
  if (!session) {
    // Carry the page that was asked for, so signing in (or the silent refresh) lands back on it.
    const asked = safeConsolePath(await requestPath(), OPERATOR_HOME);
    // Ended for inactivity (TW-AUTH-033): the sign-in page says so, with the limit.
    if (!expired && idleMinutes) redirect(operatorLoginPath(asked, { idleMinutes }));
    const next = encodeURIComponent(asked);
    redirect(
      expired
        ? `/api/platform-auth/refresh?next=${next}`
        : asked === OPERATOR_HOME
          ? '/admin/login'
          : `/admin/login?next=${next}`,
    );
  }

  // A gated super admin may only open the enrolment page, so there is nothing to count for them.
  const [counts, store, site] = await Promise.all([
    session.mfaEnrolmentRequired ? Promise.resolve({}) : getConsoleCounts(),
    cookies(),
    getSiteConfig(),
  ]);
  return (
    // Every date and time in the console is shown in the zone the super admin set in Settings, not the server's (UTC).
    <NextIntlClientProvider timeZone={resolveTimezone([site?.defaults.timezone])}>
      <ConsoleShell
        operator={session}
        counts={counts}
        initialSidebar={parseSidebarState(store.get(CONSOLE_SIDEBAR_COOKIE)?.value)}
      >
        {children}
      </ConsoleShell>
    </NextIntlClientProvider>
  );
}

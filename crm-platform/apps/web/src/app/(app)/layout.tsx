import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { AccountBanners } from '@/features/auth-registration-security/account/account-banners';
import { AccountGate } from '@/features/auth-registration-security/account/account-gate';
import { WorkspaceSwitcher } from '@/features/auth-registration-security/account/workspace-switcher';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { NAV } from '@/features/_registry/nav.generated';
import { PLANNED_NAV } from '@/features/_registry/planned';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import { THEME_COOKIE } from '@/lib/auth/cookies';
import { getSession } from '@/lib/auth/server';

/**
 * Customer workspace shell. Guards the session, hands the whole session
 * (user, org, permissions, flags) to client components, gates unverified,
 * suspended and unfinished accounts, and shapes the menu from the caller's
 * real permissions.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, expired } = await getSession();
  if (!session) redirect(expired ? '/api/auth/refresh?next=/' : '/login');

  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const capabilities = {
    ...CAPABILITIES_UNKNOWN,
    permissions: new Set(Object.keys(session.permissions)),
  };

  return (
    <SessionProvider session={session}>
      <AppShell
        user={{
          fullName: session.user.displayName ?? session.user.fullName,
          email: session.user.email,
          avatarUrl: session.user.avatarUrl,
        }}
        nav={resolveNav(NAV, capabilities, { planned: PLANNED_NAV })}
        theme={theme}
        navFooter={<WorkspaceSwitcher />}
        banners={<AccountBanners key="banners" />}
      >
        <AccountGate>{children}</AccountGate>
      </AppShell>
    </SessionProvider>
  );
}

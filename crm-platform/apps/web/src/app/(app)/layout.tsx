import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { NAV } from '@/features/_registry/nav.generated';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import { THEME_COOKIE } from '@/lib/auth/cookies';
import { getSession } from '@/lib/auth/server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session.user) redirect(session.expired ? '/api/auth/refresh?next=/dashboard' : '/login');
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <AppShell user={session.user} nav={resolveNav(NAV, CAPABILITIES_UNKNOWN)} theme={theme}>
      {children}
    </AppShell>
  );
}

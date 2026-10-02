import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getConsoleCounts } from '@/features/admin-console-shell/console-counts';
import { ConsoleShell } from '@/features/admin-console-shell/console-shell';
import {
  CONSOLE_SIDEBAR_COOKIE,
  parseSidebarState,
} from '@/features/admin-console-shell/sidebar-state';
import { getOperatorSession } from '@/lib/auth/server';

/** Platform-operator console: a separate identity pool from workspace staff. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session, expired } = await getOperatorSession();
  if (!session) redirect(expired ? '/api/platform-auth/refresh?next=/admin' : '/admin/login');

  // A gated super admin may only open the enrolment page, so there is nothing to count for them.
  const [counts, store] = await Promise.all([
    session.mfaEnrolmentRequired ? Promise.resolve({}) : getConsoleCounts(),
    cookies(),
  ]);
  return (
    <ConsoleShell
      operator={session}
      counts={counts}
      initialSidebar={parseSidebarState(store.get(CONSOLE_SIDEBAR_COOKIE)?.value)}
    >
      {children}
    </ConsoleShell>
  );
}

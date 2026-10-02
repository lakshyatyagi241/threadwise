import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OperatorShell } from '@/features/auth-registration-security/platform/operator-shell';
import {
  operatorLoginPath,
  safeConsolePath,
} from '@/features/auth-registration-security/platform/lib/next-path';
import { IpBlockedView } from '@/features/auth-registration-security/platform/ui/ip-blocked-view';
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
  return <OperatorShell operator={session}>{children}</OperatorShell>;
}

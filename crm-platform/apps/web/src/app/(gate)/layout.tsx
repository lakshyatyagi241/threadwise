import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { GateFrame } from '@/features/auth-registration-security/account/lock/gate-frame';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { getRequestSession } from '@/features/auth-registration-security/shared/session.server';

/**
 * Screens that need a signed-in person but not the app shell: first-run
 * onboarding, the suspended lock screen and the verify-email lock screen. The
 * app layout's gate would bounce a locked account away from its own lock
 * screen, so these live in their own group (TW-AUTH-016/032).
 */
export default async function GateLayout({ children }: { children: ReactNode }) {
  const { session, expired } = await getRequestSession();
  if (!session) redirect(expired ? '/api/auth/refresh?next=/' : '/login');

  return (
    <SessionProvider session={session}>
      <GateFrame>{children}</GateFrame>
    </SessionProvider>
  );
}

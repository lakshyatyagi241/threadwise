import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { authFontVariables } from '@/features/auth-registration-security/guest/auth-fonts';
import { loadRegistrationConfig } from '@/features/auth-registration-security/guest/server';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { getRequestSession } from '@/features/auth-registration-security/shared/session.server';
import { signedOutTarget } from '@/lib/auth/server';
import '@/features/auth-registration-security/guest/auth.css';

/** Page titles read "<page> - <product>", like the guest pages. */
export async function generateMetadata(): Promise<Metadata> {
  const config = await loadRegistrationConfig();
  const t = await getTranslations('auth-registration-security.guest.shell');
  const brand = config.appName.trim() || t('appNameFallback');
  return { title: { template: `%s - ${brand}`, default: brand } };
}

/**
 * Screens that need a signed-in person but not the app shell: first-run onboarding (steps 2 and 3 of sign-up,
 * drawn in the same chrome as the sign-up page), and the suspended and verify-email lock screens (standalone cards).
 * The app layout's gate would bounce a locked account away from its own lock screen, so these live in their own
 * group (TW-AUTH-016/032). The guest palette and type apply here too.
 */
export default async function GateLayout({ children }: { children: ReactNode }) {
  const { session, expired, idleMinutes } = await getRequestSession();
  if (!session) redirect(await signedOutTarget(expired, idleMinutes));

  return (
    <SessionProvider session={session}>
      <div className={`${authFontVariables} auth-scope`}>{children}</div>
    </SessionProvider>
  );
}

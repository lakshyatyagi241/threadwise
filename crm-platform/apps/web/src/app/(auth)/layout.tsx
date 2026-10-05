import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { authFontVariables } from '@/features/auth-registration-security/guest/auth-fonts';
import { CookieBanner } from '@/features/auth-registration-security/guest/cookie-banner';
import { loadRegistrationConfig } from '@/features/auth-registration-security/guest/server';
import '@/features/auth-registration-security/guest/auth.css';

/**
 * Every guest page (sign-in, sign-up, recovery, emailed-link landings, social callback) shares this layout: the
 * guest type and palette (scoped to `.auth-scope`, so the signed-in app is untouched), the page title pattern
 * "<page> - <product>", a notice for browsers without JavaScript (the forms need it) and the cookie notice.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await loadRegistrationConfig();
  const t = await getTranslations('auth-registration-security.guest.shell');
  const brand = config.appName.trim() || t('appNameFallback');
  return { title: { template: `%s - ${brand}`, default: brand } };
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const config = await loadRegistrationConfig();
  const t = await getTranslations('auth-registration-security.guest.layout');
  return (
    <div className={`${authFontVariables} auth-scope`}>
      <noscript>
        <div
          role="alert"
          className="bg-(--auth-coral)/15 px-4 py-2 text-center text-[13px] text-(--auth-coral-ink)"
        >
          {t('noscript')}
        </div>
      </noscript>
      {children}
      <CookieBanner learnMoreUrl={config.links.cookies ?? config.links.privacy} />
    </div>
  );
}

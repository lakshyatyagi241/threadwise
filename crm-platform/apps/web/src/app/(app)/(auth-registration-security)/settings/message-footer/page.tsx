import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BrandingView } from '@/features/auth-registration-security/account/branding/branding-view';
import { SettingsBack } from '@/features/settings-hub/settings-back';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.messageFooterPage');
  return { title: t('title') };
}

/**
 * The message footer (the line that ends messages sent from automations, scheduled sends and team inbox replies),
 * a standalone Settings page under Channels. It used to be the Branding pane of the account hub.
 */
export default async function MessageFooterPage() {
  const t = await getTranslations('auth-registration-security.account.messageFooterPage');
  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <SettingsBack always />
      <header className="space-y-2">
        <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
          {t('titleLead')} <span className="not-italic text-brand">{t('titleAccent')}</span>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <BrandingView showHeading={false} />
    </main>
  );
}

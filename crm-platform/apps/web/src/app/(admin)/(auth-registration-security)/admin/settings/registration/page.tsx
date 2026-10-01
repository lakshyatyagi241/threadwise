import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegistrationSettingsPage } from '@/features/auth-registration-security/platform/settings/registration-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.registration') };
}

export default function RegistrationPolicyPage() {
  return <RegistrationSettingsPage />;
}

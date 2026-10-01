import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BrandingView } from '@/features/auth-registration-security/account/branding/branding-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.hub');
  return { title: t('pages.branding.title') };
}

export default function BrandingPage() {
  return <BrandingView />;
}

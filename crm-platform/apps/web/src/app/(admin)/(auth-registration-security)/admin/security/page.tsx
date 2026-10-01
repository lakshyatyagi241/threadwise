import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SecurityCenter } from '@/features/auth-registration-security/platform/security/security-center';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.securityCenter') };
}

export default function SecurityCenterPage() {
  return <SecurityCenter />;
}

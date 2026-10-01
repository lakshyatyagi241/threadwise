import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { SecurityEvents } from '@/features/auth-registration-security/platform/events/security-events';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.securityEvents') };
}

export default function SecurityEventsPage() {
  return (
    <Suspense>
      <SecurityEvents />
    </Suspense>
  );
}

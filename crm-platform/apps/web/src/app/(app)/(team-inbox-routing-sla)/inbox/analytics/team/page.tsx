import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { TeamPerformanceScreen } from '@/features/team-inbox-routing-sla/components/team-performance-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('team-inbox-routing-sla.performance');
  return { title: t('title') };
}

export default function TeamPerformancePage() {
  return (
    <Suspense>
      <TeamPerformanceScreen />
    </Suspense>
  );
}

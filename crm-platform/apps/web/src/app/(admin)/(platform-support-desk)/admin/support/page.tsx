import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { InboxPage } from '@/features/platform-support-desk/operator/inbox-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('inbox') };
}

export default function OperatorSupportPage() {
  // The inbox reads the URL (?open=<ticket>), which needs a Suspense boundary.
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}

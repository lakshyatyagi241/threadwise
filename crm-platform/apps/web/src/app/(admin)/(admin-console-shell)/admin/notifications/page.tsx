import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { NotificationsPage } from '@/features/admin-console-shell/header/notifications-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin-console-shell.notificationsPage');
  return { title: t('title') };
}

/** `/admin/notifications`: the platform activity feed behind the bell's "View all". */
export default function Page() {
  return (
    <Suspense>
      <NotificationsPage />
    </Suspense>
  );
}

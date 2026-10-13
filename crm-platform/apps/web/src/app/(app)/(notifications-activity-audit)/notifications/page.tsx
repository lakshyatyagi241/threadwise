import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NotificationsPage } from '@/features/notifications-activity-audit/page/notifications-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.page');
  return { title: t('title') };
}

/** The full Notifications page behind the bell's "View all". */
export default function NotificationsRoute() {
  return <NotificationsPage />;
}

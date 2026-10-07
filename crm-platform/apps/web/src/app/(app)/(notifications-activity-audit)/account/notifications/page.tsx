import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountFrame } from '@/features/auth-registration-security/shared/account-hub';
import { PreferencesScreen } from '@/features/notifications-activity-audit/components/preferences-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.prefs');
  return { title: t('title') };
}

/** Notification preferences: a pane of the account hub where the signed-in person tunes the bell, pop-up and sound per event. */
export default function NotificationPreferencesPage() {
  return (
    <AccountFrame>
      <PreferencesScreen />
    </AccountFrame>
  );
}

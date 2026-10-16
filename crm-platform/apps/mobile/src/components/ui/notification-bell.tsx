import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useUnreadCount } from '@/lib/notifications/unread';
import { HeaderIconButton } from './screen-header';

/** The bell in a tab's header: opens the notification list, with a dot while something is unread. */
export function NotificationBell() {
  const { t } = useTranslation();
  const router = useRouter();
  const unread = useUnreadCount().data ?? 0;
  return (
    <HeaderIconButton
      icon="notifications-outline"
      label={
        unread > 0
          ? t('notifications.bell.labelUnread', { count: unread })
          : t('notifications.bell.label')
      }
      dot={unread > 0}
      testID="notification-bell"
      onPress={() => router.push('/notifications')}
    />
  );
}

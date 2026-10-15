import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { requestNotificationPermission } from '@/lib/device/notification-permission';
import { log } from '@/lib/observability/logger';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The person chose (or skipped): the screen is not shown again. */
  onDone: () => void;
}

function Row({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={24} color="primary" />
      </View>
      <View style={styles.rowText}>
        <Text variant="label">{title}</Text>
        <Text muted>{body}</Text>
      </View>
    </View>
  );
}

/**
 * The first time the app opens: what it would like to be allowed to do, and why, before the phone's own prompt appears. The prompt
 * comes only when the person presses "Continue", never on its own; "Not now" asks the phone nothing (the Menu's "Device
 * permissions" opens the phone's settings later). Today the only permission is notifications; a new permission becomes a new row
 * here, added with the feature that uses it.
 */
export function PermissionsScreen({ onDone }: Props) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  const allow = async () => {
    setAsking(true);
    try {
      await requestNotificationPermission(t('permissions.intro.channelName'));
    } catch (error) {
      // Whatever the phone answers, or fails to, the person goes on to the app: they can change it in the settings.
      log.exception(error, 'onboarding.permission_request_failed');
    } finally {
      onDone();
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <BrandMark size={56} />
        <Text variant="title" accessibilityRole="header">
          {t('permissions.intro.title')}
        </Text>
        <Text muted>{t('permissions.intro.subtitle')}</Text>
      </View>
      <Row
        icon="notifications-outline"
        title={t('permissions.intro.notificationsTitle')}
        body={t('permissions.intro.notificationsBody')}
      />
      <View style={styles.actions}>
        <Button
          label={t('permissions.intro.allow')}
          loading={asking}
          onPress={() => void allow()}
        />
        <Button
          variant="link"
          label={t('permissions.intro.notNow')}
          disabled={asking}
          onPress={onDone}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.md, paddingTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});

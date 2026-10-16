import type { NotificationResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  formatRowTime,
  lookOf,
  type DaySection,
  type NotificationTone,
} from './notification-model';
import { notificationText, type Translator } from './notification-text';

const BUBBLE = 40;
const DOT = 10;

const TONES: Record<NotificationTone, { background: keyof ThemeColors; icon: keyof ThemeColors }> =
  {
    info: { background: 'primarySoft', icon: 'primary' },
    success: { background: 'successSoft', icon: 'success' },
    danger: { background: 'dangerSoft', icon: 'danger' },
  };

interface Props {
  row: NotificationResponse;
  section: DaySection;
  translate: Translator;
  /** This row's dismiss request is in flight. */
  busy: boolean;
  onOpen: (row: NotificationResponse) => void;
  onDismiss: (row: NotificationResponse) => void;
}

/**
 * One notification: an icon that says what kind it is, the words (in the person's language), the time, and a dot while unread.
 * The row opens what it is about (and marks itself read); the cross at the end dismisses it for good.
 */
function NotificationRowBase({ row, section, translate, busy, onOpen, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { icon, tone } = lookOf(row.type);
  const pair = TONES[tone];
  const words = notificationText(translate, row);
  const unread = row.readAt === null;
  const when = formatRowTime(row.createdAt, section, i18n.language);
  const label = [unread ? t('notifications.unread') : null, words.title, words.body, when]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onOpen(row)}
        style={styles.main}
      >
        <View style={[styles.bubble, { backgroundColor: colors[pair.background] }]}>
          <Icon name={icon} size={20} color={pair.icon} />
        </View>
        <View style={styles.text}>
          <Text variant={unread ? 'label' : 'body'} muted={!unread} numberOfLines={2}>
            {words.title}
          </Text>
          {words.body ? (
            <Text variant="caption" muted numberOfLines={2}>
              {words.body}
            </Text>
          ) : null}
          <Text variant="caption" muted numberOfLines={1}>
            {when}
          </Text>
        </View>
        {unread ? (
          <View
            testID="notification-unread-dot"
            style={[styles.dot, { backgroundColor: colors.primary }]}
          />
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.dismiss')}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => onDismiss(row)}
        style={[styles.dismiss, busy && styles.faded]}
      >
        <Icon name="close" size={20} color="textMuted" />
      </Pressable>
    </View>
  );
}

export const NotificationRow = memo(NotificationRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingStart: spacing.lg,
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xs },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dismiss: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.4 },
});

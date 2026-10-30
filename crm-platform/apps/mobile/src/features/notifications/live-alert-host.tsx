import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FadeIn } from '@/components/ui/fade-in';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { useLiveAlert } from './use-live-alert';
import { lookOf } from './notification-model';
import { notificationText, translatorFor } from './notification-text';

const BUBBLE = 40;
const ELEVATION = 6;
const SHADOW_OPACITY = 0.18;
const SHADOW_RADIUS = 10;

/**
 * The alert that drops down over any screen when a chat message arrives while the app is open (the web's live toast). Tapping it opens
 * the chat; the cross sends it away; it also goes by itself after a few seconds. Said once to screen readers (a polite live region).
 */
export function LiveAlertHost() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { row, dismiss, open } = useLiveAlert();
  const translate = useMemo(() => translatorFor(i18n), [i18n]);

  const words = row ? notificationText(translate, row) : null;
  const label = words ? [words.title, words.body].filter(Boolean).join('. ') : '';

  // The region stays mounted when there is nothing to show: a screen reader announces what changes inside a live region, not a
  // region that appears already holding its text.
  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[styles.host, { top: insets.top + spacing.sm }]}
    >
      {row && words ? (
        <FadeIn key={row.id}>
          <View
            testID="live-alert"
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={open}
              style={styles.main}
            >
              <View style={[styles.bubble, { backgroundColor: colors.primarySoft }]}>
                <Icon name={lookOf(row.type).icon} size={20} color="primary" />
              </View>
              <View style={styles.text}>
                <Text variant="label" numberOfLines={1}>
                  {words.title}
                </Text>
                {words.body ? (
                  <Text variant="caption" muted numberOfLines={2}>
                    {words.body}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('notifications.dismiss')}
              onPress={dismiss}
              style={styles.close}
            >
              <Icon name="close" size={20} color="textMuted" />
            </Pressable>
          </View>
        </FadeIn>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', start: spacing.md, end: spacing.md, zIndex: 100 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingStart: spacing.md,
    elevation: ELEVATION,
    shadowOpacity: SHADOW_OPACITY,
    shadowRadius: SHADOW_RADIUS,
    shadowOffset: { width: 0, height: spacing.xs },
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xs },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

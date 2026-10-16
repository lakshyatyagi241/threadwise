import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ROWS = Array.from({ length: 8 }, (_, i) => i);

/** Quiet placeholder rows while the first page loads, so the list does not jump when it arrives. */
export function NotificationSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View accessible accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }}>
      {ROWS.map((i) => (
        <View key={i} style={styles.row} testID="notification-skeleton-row">
          <View style={[styles.bubble, bar]} />
          <View style={styles.lines}>
            <View style={[styles.line, styles.long, bar]} />
            <View style={[styles.line, styles.short, bar]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  bubble: { width: 40, height: 40, borderRadius: radius.pill },
  lines: { flex: 1, gap: spacing.sm },
  line: { height: 12, borderRadius: radius.sm },
  long: { width: '70%' },
  short: { width: '45%' },
});

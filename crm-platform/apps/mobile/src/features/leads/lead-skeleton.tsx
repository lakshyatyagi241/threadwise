import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ROWS = Array.from({ length: 6 }, (_, i) => i);

/** Quiet placeholder rows while the first answer loads, so the screen does not jump when it arrives. */
export function LeadSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View accessible accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }}>
      {ROWS.map((i) => (
        <View key={i} style={styles.row} testID="lead-skeleton-row">
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
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  lines: { gap: spacing.sm },
  line: { height: 12, borderRadius: radius.sm },
  long: { width: '60%' },
  short: { width: '35%' },
});

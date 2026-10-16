import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ROWS = Array.from({ length: 6 }, (_, i) => i);

/** Quiet placeholder cards while the first page loads, so the list does not jump when it arrives. */
export function DealSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View accessible accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }}>
      {ROWS.map((i) => (
        <View
          key={i}
          testID="deal-skeleton-row"
          style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <View style={[styles.line, styles.long, bar]} />
          <View style={[styles.line, styles.short, bar]} />
          <View style={[styles.line, styles.mid, bar]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  line: { height: 12, borderRadius: radius.sm },
  long: { width: '70%' },
  mid: { width: '45%' },
  short: { width: '35%' },
});

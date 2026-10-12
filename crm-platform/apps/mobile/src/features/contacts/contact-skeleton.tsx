import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ROWS = Array.from({ length: 20 }, (_, i) => i);

/** Twenty quiet placeholder rows while the first page loads, so the list does not jump when it arrives. */
export function ContactSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View accessible accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }}>
      {ROWS.map((i) => (
        <View key={i} style={styles.row} testID="contact-skeleton-row">
          <View style={[styles.avatar, bar]} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  lines: { flex: 1, gap: spacing.sm },
  line: { height: 12, borderRadius: radius.sm },
  long: { width: '60%' },
  short: { width: '35%' },
});

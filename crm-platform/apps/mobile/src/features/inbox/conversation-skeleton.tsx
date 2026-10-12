import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export const SKELETON_ROWS = 20;

/** What the list shows on the first load: grey bars in the shape of rows. One announcement for the screen reader, not twenty. */
export function ConversationSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      importantForAccessibility="yes"
    >
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <View key={i} style={styles.row} testID="skeleton-row">
          <View style={[styles.avatar, bar]} />
          <View style={styles.lines}>
            <View style={[styles.line, styles.wide, bar]} />
            <View style={[styles.line, styles.narrow, bar]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  lines: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  line: { height: 12, borderRadius: 6 },
  wide: { width: '70%' },
  narrow: { width: '45%' },
});

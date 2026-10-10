import { StyleSheet, View } from 'react-native';
import { radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const PAIRS: Record<BadgeTone, { background: keyof ThemeColors; text: keyof ThemeColors }> = {
  success: { background: 'successSoft', text: 'success' },
  warning: { background: 'warningSoft', text: 'warning' },
  danger: { background: 'dangerSoft', text: 'danger' },
  info: { background: 'primarySoft', text: 'primary' },
  neutral: { background: 'surfaceMuted', text: 'textMuted' },
};

/** A short status word in a soft pill. The words carry the meaning; the colour only backs them up. */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const pair = PAIRS[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors[pair.background] }]}>
      <Text variant="caption" style={styles.text} color={pair.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  text: { fontWeight: '600' },
});

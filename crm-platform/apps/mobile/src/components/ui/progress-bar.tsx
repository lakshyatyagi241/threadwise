import { StyleSheet, View } from 'react-native';
import { clampPercent } from '@/lib/format/numbers';
import { radius } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** 0..100. */
  percent: number;
  tone?: 'primary' | 'success' | 'danger' | 'warning';
  /** Reads the bar out on its own. Leave it out when the number sits right beside the bar, so it is not announced twice. */
  label?: string;
}

/** A thin bar showing a share of a whole. */
export function ProgressBar({ percent, tone = 'primary', label }: Props) {
  const { colors } = useTheme();
  const now = Math.round(clampPercent(percent));
  return (
    <View
      accessible={Boolean(label)}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      accessibilityRole={label ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now } : undefined}
      style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
    >
      <View
        style={[styles.fill, { width: `${clampPercent(percent)}%`, backgroundColor: colors[tone] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});

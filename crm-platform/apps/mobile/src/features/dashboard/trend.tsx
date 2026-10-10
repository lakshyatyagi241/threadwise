import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { directionOf, isGood, signed } from '@/lib/format/numbers';
import { radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ARROW = { up: '▲', down: '▼', flat: '–' } as const;

interface Props {
  delta: number;
  /** `pp` = percentage points (a change of a rate), `%` = a change of a count. */
  unit?: '%' | 'pp';
  lowerIsBetter?: boolean;
  /** A move for the worse is amber, not red, where a drop is a nudge and not an alarm. */
  mildDown?: boolean;
}

/** A change against the previous window: arrow and size, green or red by whether it is good news. Never colour alone: the sign is text. */
export function Trend({ delta, unit = '%', lowerIsBetter = false, mildDown = false }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const direction = directionOf(delta);
  const good = isGood(delta, lowerIsBetter);
  const tone: { background: keyof ThemeColors; text: keyof ThemeColors } =
    good === null
      ? { background: 'surfaceMuted', text: 'textMuted' }
      : good
        ? { background: 'successSoft', text: 'success' }
        : mildDown
          ? { background: 'warningSoft', text: 'warning' }
          : { background: 'dangerSoft', text: 'danger' };
  const size = `${Math.abs(delta)}${unit === 'pp' ? ' pp' : '%'}`;
  const label =
    direction === 'flat'
      ? t('dashboard.trend.flat')
      : direction === 'up'
        ? t('dashboard.trend.up', { value: size })
        : t('dashboard.trend.down', { value: size });
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: colors[tone.background] }]}
    >
      <Text variant="caption" color={tone.text} style={styles.text} importantForAccessibility="no">
        {ARROW[direction]} {signed(delta, unit === 'pp' ? ' pp' : '%')}
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

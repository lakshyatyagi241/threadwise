import { StyleSheet, View } from 'react-native';
import { barLength } from '@/lib/format/numbers';
import { radius } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const HEIGHT = 36;

interface Props {
  values: readonly number[];
  /** What the bars are, read out as one sentence. The bars themselves are hidden from screen readers. */
  label: string;
}

/** A row of thin bars that shows the shape of a series at a glance (messages sent per hour, oldest first). */
export function Sparkline({ values, label }: Props) {
  const { colors } = useTheme();
  const top = Math.max(1, ...values);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.row}>
      {values.map((value, index) => (
        <View key={index} style={styles.slot}>
          <View
            style={[
              styles.bar,
              {
                height: barLength(value, top, HEIGHT) || 2,
                backgroundColor: value > 0 ? colors.primary : colors.border,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT, gap: 2 },
  slot: { flex: 1, height: HEIGHT, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.sm / 3 },
});

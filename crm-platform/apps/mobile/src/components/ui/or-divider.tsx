import { StyleSheet, View } from 'react-native';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

/** A line, a short word ("OR") and a line: what separates the main way of doing something from the alternative under it. */
export function OrDivider({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} testID="or-divider">
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      <Text variant="caption" muted>
        {label}
      </Text>
      <View style={[styles.line, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});

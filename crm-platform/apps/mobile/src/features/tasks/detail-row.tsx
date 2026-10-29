import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  label: string;
  /** The value as text. */
  value?: string;
  /** Something richer than text: a link. Wins over `value`. */
  children?: ReactNode;
}

/** One line of the task details, as the Geta app draws it: the label, the value in a quieter tone under it, a line below. */
export function DetailRow({ label, value, children }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text>{label}</Text>
      {children ?? (
        <Text variant="caption" muted>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

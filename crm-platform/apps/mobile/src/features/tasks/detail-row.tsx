import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';

interface Props {
  label: string;
  /** The value as text. */
  value?: string;
  /** Something richer than text: a badge, a link. Wins over `value`. */
  children?: ReactNode;
  /** The value is a "nothing here" sentence, so it is quieter. */
  empty?: boolean;
}

/** A label above its value, one line of the task card. */
export function DetailRow({ label, value, children, empty }: Props) {
  return (
    <View style={styles.row}>
      <Text variant="caption" muted>
        {label}
      </Text>
      {children ?? <Text muted={empty}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});

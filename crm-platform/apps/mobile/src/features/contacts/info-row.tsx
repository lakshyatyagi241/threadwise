import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';

interface Props {
  label: string;
  /** The value as text; a row with neither text nor `children` is not drawn. */
  value?: string | null;
  /** Something richer than text, such as a badge. */
  children?: ReactNode;
  /** Makes the value a link; `linkLabel` is what a screen reader says for it ("Call +91 …"). */
  onPress?: () => void;
  linkLabel?: string;
}

/** A label above its value, one line of a detail card. */
export function InfoRow({ label, value, children, onPress, linkLabel }: Props) {
  if (!value && !children) return null;
  return (
    <View style={styles.row}>
      <Text variant="caption" muted>
        {label}
      </Text>
      {children ??
        (onPress ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={linkLabel ?? value ?? label}
            onPress={onPress}
            style={styles.link}
          >
            <Text color="primary">{value}</Text>
          </Pressable>
        ) : (
          <Text>{value}</Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
});

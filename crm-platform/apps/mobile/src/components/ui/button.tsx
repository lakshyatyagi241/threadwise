import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

interface Props extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  /** What a screen reader says when the visible `label` is not enough alone (a "Delete" inside a list says whose). */
  accessibilityLabel?: string;
  /** `primary` is the one action of a screen, `secondary` an alternative, `link` a quiet text action (it sits inside a sentence of UI). */
  variant?: 'primary' | 'secondary' | 'link';
  loading?: boolean;
  /** Where a `link` sits in its row: centred (after a sentence), or at the start, lined up with the fields above it. */
  align?: 'center' | 'start';
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  align = 'center',
  disabled,
  accessibilityLabel,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const inactive = Boolean(disabled) || loading;
  const primary = variant === 'primary';
  const link = variant === 'link';
  const textColor = primary ? colors.onPrimary : link ? colors.primary : colors.text;
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        link ? styles.link : styles.base,
        link && align === 'start' && styles.linkStart,
        !link && {
          backgroundColor: primary ? colors.primary : colors.surface,
          borderColor: primary ? colors.primary : colors.borderStrong,
        },
        { opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text
          variant="label"
          style={[
            styles.label,
            link && align === 'start' && styles.labelStart,
            { color: textColor },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkStart: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  label: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  // A link lined up with the fields above it also lines its wrapped text up with them (start of the line, in either direction).
  labelStart: { textAlign: 'auto' },
});

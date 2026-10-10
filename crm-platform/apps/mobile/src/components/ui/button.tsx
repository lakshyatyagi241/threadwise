import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

interface Props extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  /** `primary` is the one action of a screen, `secondary` an alternative, `link` a quiet text action (it sits inside a sentence of UI). */
  variant?: 'primary' | 'secondary' | 'link';
  loading?: boolean;
  /** Where a `link` sits in its row: centred (after a sentence), or at the start, lined up with the fields above it. */
  align?: 'center' | 'start';
}

/**
 * Android measures a shrink-wrapped text with one set of font metrics and draws it with another. For some scripts (Devanagari in
 * semi-bold, seen with Marathi and Hindi) the drawn text is a fraction of a pixel wider than its box, so the last word wraps onto a
 * second line the button has no room for and disappears. One trailing no-break space gives every label that little bit of slack;
 * it is invisible, and the spoken name (`accessibilityLabel`) is the label without it. Built from its code so that no invisible
 * character sits in the source.
 */
const SLACK = String.fromCharCode(0xa0);

export function Button({
  label,
  variant = 'primary',
  loading = false,
  align = 'center',
  disabled,
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
      accessibilityLabel={label}
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
          {label + SLACK}
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

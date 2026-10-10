import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

interface Props extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export function Button({ label, variant = 'primary', loading = false, disabled, ...rest }: Props) {
  const { colors } = useTheme();
  const inactive = Boolean(disabled) || loading;
  const primary = variant === 'primary';
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: primary ? colors.primary : 'transparent',
          borderColor: primary ? colors.primary : colors.border,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.text} />
      ) : (
        <Text variant="label" style={{ color: primary ? colors.onPrimary : colors.text }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

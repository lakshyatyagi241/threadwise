import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
}

/** A labelled input. The label is read by screen readers as the field's name; the error is announced when it appears. */
export function TextField({ label, error, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" danger accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
});

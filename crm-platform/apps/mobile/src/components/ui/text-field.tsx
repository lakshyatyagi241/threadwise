import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CONTROL_HEIGHT, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

/** What `inputRef` points at: enough for a screen to move focus to the next field. */
export type TextFieldHandle = TextInput;

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  /** Helper text under the field: what to type, or which rule applies. Read out after the label; replaced by `error` when there is one. */
  hint?: string;
  /** Something that sits inside the field at its end, such as the show/hide switch of a password. */
  end?: ReactNode;
  /** For one-time codes: centred, large, widely spaced digits. */
  code?: boolean;
  inputRef?: Ref<TextFieldHandle>;
}

/**
 * A labelled input. The label is read by screen readers as the field's name; the error is announced when it appears. The border
 * follows the state (idle, focused, error) so a person always knows which field they are in and which one needs fixing.
 */
export function TextField({
  label,
  error,
  hint,
  end,
  code,
  inputRef,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.borderStrong;
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor }]}>
        <TextInput
          {...rest}
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, code && styles.code, { color: colors.text }]}
        />
        {end}
      </View>
      {error ? (
        <Text variant="caption" danger accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  field: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  code: { textAlign: 'center', fontSize: 26, fontWeight: '700', letterSpacing: 8 },
});

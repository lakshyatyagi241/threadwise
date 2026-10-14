import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Icon } from './icon';

export interface SearchFieldProps extends Omit<TextInputProps, 'style' | 'value'> {
  /** The input's name for screen readers (there is no visible label: the placeholder says what to type). */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** What the clear button is called for screen readers. */
  clearLabel: string;
}

/**
 * A search box: a magnifier at the start, the placeholder inside, and a clear button once something is typed. The border
 * follows focus the way `TextField`'s does. Use `TextField` instead when the field needs a visible label or an error.
 */
export function SearchField({
  label,
  value,
  onChangeText,
  clearLabel,
  onFocus,
  onBlur,
  ...rest
}: SearchFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.primary : colors.borderStrong,
        },
      ]}
    >
      <View style={styles.icon}>
        <Icon name="search-outline" size={20} color="textMuted" />
      </View>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { color: colors.text }]}
      />
      {value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={() => onChangeText('')}
          style={styles.clear}
        >
          <Icon name="close-circle" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingStart: spacing.md,
  },
  icon: { paddingEnd: spacing.sm },
  input: { flex: 1, minHeight: CONTROL_HEIGHT, paddingVertical: spacing.md, fontSize: 16 },
  clear: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

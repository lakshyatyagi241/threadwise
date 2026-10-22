import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface FieldProps {
  label: string;
  value: string;
  onPress: () => void;
  error?: string | null;
  /** The icon at the end of the box: a down chevron for a list, a calendar or a clock for a picker. */
  icon?: IconName;
  /** The value is the hint for an empty field, so it is drawn in the placeholder grey. */
  placeholder?: boolean;
}

/** A form field that shows its chosen value and opens a list to change it: the label above, the value in a box with a chevron. */
export function PickerField({
  label,
  value,
  onPress,
  error,
  icon = 'chevron-down',
  placeholder = false,
}: FieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        onPress={onPress}
        style={[
          styles.box,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.borderStrong,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.value, placeholder && { color: colors.placeholder }]}
        >
          {value}
        </Text>
        <Icon name={icon} size={icon === 'chevron-down' ? 18 : 22} color="textMuted" />
      </Pressable>
      {error ? (
        <Text variant="caption" danger accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

interface OptionProps {
  label: string;
  caption?: string | null;
  selected: boolean;
  onPress: () => void;
}

/** One choice in a picker sheet; the chosen one carries a tick. */
export function PickerOption({ label, caption, selected, onPress }: OptionProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={styles.option}
    >
      <View style={styles.optionText}>
        <Text variant={selected ? 'label' : 'body'} numberOfLines={1}>
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" muted numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="checkmark" size={20} color="primary" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  box: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  value: { flex: 1 },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionText: { flex: 1 },
});

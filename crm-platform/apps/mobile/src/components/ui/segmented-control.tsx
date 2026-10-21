import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

interface Option<T extends string> {
  value: T;
  label: string;
  /** What a screen reader says for this option, when the short label alone is unclear ("24h" -> "Last 24 hours"). */
  accessibilityLabel?: string;
}

interface Props<T extends string> {
  /** Names the group for screen readers. */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `equal` (the default) gives every segment the same width; `content` shares the width by the length of each label, so one long label is not cut off beside short ones. */
  fit?: 'equal' | 'content';
}

/** One choice out of a few, always visible: the range picker of the dashboard. Each segment is a radio button. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  fit = 'equal',
}: Props<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              fit === 'content' && styles.content,
              fit === 'content' && { flexGrow: option.label.length + 3 },
              selected && { backgroundColor: colors.primary },
            ]}
          >
            <Text variant="label" color={selected ? 'onPrimary' : 'textMuted'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  // No equal share: each segment's share grows with its text (set where it is drawn), and the padding is tighter, so a long label is not cut off.
  content: { flexBasis: 0, paddingHorizontal: spacing.xs },
});

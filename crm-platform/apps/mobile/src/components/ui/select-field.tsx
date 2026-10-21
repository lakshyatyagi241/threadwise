import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONTROL_HEIGHT, MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Icon } from './icon';
import { Text } from './text';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  /** What the control is for, for a screen reader ("Agent"). */
  label: string;
  /** Shown in the box while nothing is chosen. */
  placeholder: string;
  options: readonly SelectOption[];
  /** The chosen value; a value that is in no option shows the placeholder. */
  value: string | undefined;
  onChange: (value: string) => void;
  /** `plain` has no border or fill: the value and its chevron sit in a form row that draws its own lines. */
  variant?: 'box' | 'plain';
  /** Greyed out and not openable, for a list that has no choices (the status of a stage without statuses). */
  disabled?: boolean;
}

/** A boxed dropdown: the chosen label (or the placeholder) with a chevron, opening a list of choices; the chosen one carries a tick. */
export function SelectField({
  label,
  placeholder,
  options,
  value,
  onChange,
  variant = 'box',
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? placeholder }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={
          variant === 'plain'
            ? styles.plain
            : [
                styles.box,
                {
                  backgroundColor: disabled ? colors.surfaceMuted : colors.surface,
                  borderColor: open ? colors.primary : colors.borderStrong,
                },
              ]
        }
      >
        <Text numberOfLines={1} style={[styles.value, !current && { color: colors.placeholder }]}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color="textMuted" />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={() => setOpen(false)}
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                paddingBottom: insets.bottom + spacing.md,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text variant="subheading" numberOfLines={1} style={styles.title}>
              {label}
            </Text>
            <ScrollView bounces={false}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityLabel={o.label}
                  accessibilityState={{ checked: o.value === value }}
                  onPress={() => {
                    setOpen(false);
                    onChange(o.value);
                  }}
                  style={[
                    styles.option,
                    o.value === value && { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Text
                    variant={o.value === value ? 'label' : 'body'}
                    numberOfLines={1}
                    style={styles.value}
                  >
                    {o.label}
                  </Text>
                  {o.value === value ? <Icon name="checkmark" size={20} color="primary" /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  plain: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  value: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  title: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});

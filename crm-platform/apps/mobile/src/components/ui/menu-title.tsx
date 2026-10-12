import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Icon } from './icon';
import { Text } from './text';

export interface MenuOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** What the control is for, for a screen reader ("Inbox view"). */
  label: string;
  options: readonly MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A header title that opens a short list to switch the view ("All", "Mine", "Unassigned"). The chosen one shows with a tick. */
export function MenuTitle<T extends string>({ label, options, value, onChange }: Props<T>) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label }}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <Text variant="heading">{current?.label}</Text>
        <Icon name="chevron-down" size={16} color="textMuted" />
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
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {options.map((o) => (
              <Pressable
                key={o.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: o.value === value }}
                onPress={() => {
                  setOpen(false);
                  onChange(o.value);
                }}
                style={styles.option}
              >
                <Text variant={o.value === value ? 'label' : 'body'}>{o.label}</Text>
                {o.value === value ? <Icon name="checkmark" size={20} color="primary" /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  scrim: { flex: 1, paddingTop: 96, paddingHorizontal: spacing.lg },
  sheet: {
    alignSelf: 'flex-start',
    minWidth: 220,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});

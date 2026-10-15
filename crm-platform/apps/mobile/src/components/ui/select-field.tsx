import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
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
}

/** A boxed dropdown: the chosen label (or the placeholder) with a chevron, opening a list of choices; the chosen one carries a tick. */
export function SelectField({ label, placeholder, options, value, onChange }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? placeholder }}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}
      >
        <Text muted={!current} numberOfLines={1} style={styles.value}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color="textMuted" />
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
            <ScrollView>
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
                  style={styles.option}
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
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  value: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  sheet: {
    maxHeight: '70%',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});

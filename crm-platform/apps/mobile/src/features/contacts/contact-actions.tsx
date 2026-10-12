import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export interface ContactAction {
  key: string;
  icon: IconName;
  label: string;
  /** Faded and not pressable: there is nothing to dial, or the person may not use it. */
  disabled?: boolean;
  /** True while the action is looking something up. */
  busy?: boolean;
  onPress: () => void;
}

/** The round shortcuts under a contact's name: call, chat, mail, text, tasks, notes. Each one says what it does underneath. */
export function ContactActions({ actions }: { actions: readonly ContactAction[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityState={{ disabled: a.disabled, busy: a.busy }}
          disabled={a.disabled || a.busy}
          onPress={a.onPress}
          style={[styles.item, a.disabled && styles.faded]}
        >
          <View style={[styles.circle, { backgroundColor: colors.primarySoft }]}>
            <Icon name={a.icon} size={22} color="primary" />
          </View>
          <Text variant="caption" muted numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  item: { flex: 1, alignItems: 'center', gap: spacing.xs, minHeight: MIN_TOUCH_TARGET },
  circle: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.4 },
});

import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** The width of one icon button when the shortcuts share a line with the name: a full finger wide. */
const COMPACT_WIDTH = MIN_TOUCH_TARGET;

export interface ContactAction {
  key: string;
  icon: IconName;
  /** The icon's colour when it is not the app's accent (chat is the WhatsApp green). */
  color?: keyof ThemeColors;
  label: string;
  /** Faded and not pressable: there is nothing to dial, or the person may not use it. */
  disabled?: boolean;
  /** True while the action is looking something up. */
  busy?: boolean;
  onPress: () => void;
}

interface Props {
  actions: readonly ContactAction[];
  /**
   * Icons only, for a row of a list: the name a screen reader reads comes from `describe` (so a list of contacts does not say
   * "Call" thirty times but "Call Aarav Sharma").
   */
  compact?: boolean;
  describe?: (label: string) => string;
}

/** The round shortcuts under a contact's name: call, chat, mail, text, tasks, notes. Each one says what it does underneath. */
export function ContactActions({ actions, compact, describe }: Props) {
  const { colors } = useTheme();
  return (
    <View style={compact ? styles.rowCompact : styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          accessibilityRole="button"
          accessibilityLabel={describe ? describe(a.label) : a.label}
          accessibilityState={{ disabled: a.disabled, busy: a.busy }}
          disabled={a.disabled || a.busy}
          onPress={a.onPress}
          style={[compact ? styles.itemCompact : styles.item, a.disabled && styles.faded]}
        >
          {compact ? (
            <View style={styles.inline}>
              <Icon name={a.icon} size={22} color={a.color ?? 'primary'} />
            </View>
          ) : (
            <>
              <View style={[styles.circle, { backgroundColor: colors.primarySoft }]}>
                <Icon name={a.icon} size={22} color={a.color ?? 'primary'} />
              </View>
              <Text variant="caption" muted numberOfLines={1}>
                {a.label}
              </Text>
            </>
          )}
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
  // In a list row the icons share the line with the name: each is as wide and as tall as a finger needs.
  rowCompact: { flexDirection: 'row', alignItems: 'center' },
  itemCompact: {
    width: COMPACT_WIDTH,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: { alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.4 },
});

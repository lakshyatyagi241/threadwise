import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Icon, MaterialIcon, type IconName, type MaterialIconName } from './icon';

/** The top bar of a tab: the title (or a menu that picks the view) on the left, icon buttons on the right. */
export function ScreenHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top,
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.title}>{children}</View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

interface ButtonProps {
  /** An Ionicons name, or `{ material }` for a Material one. */
  icon: IconName | { material: MaterialIconName };
  label: string;
  onPress: () => void;
  /** A small dot on the corner: something is switched on behind this button (a filter). */
  dot?: boolean;
  testID?: string;
}

/** A square icon button with the 48 point tap target; the label is what a screen reader says. */
export function HeaderIconButton({ icon, label, onPress, dot, testID }: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={styles.button}
    >
      {typeof icon === 'string' ? (
        <Icon name={icon} size={22} />
      ) : (
        <MaterialIcon name={icon.material} size={24} />
      )}
      {dot ? <View style={[styles.dot, { backgroundColor: colors.danger }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  title: { flex: 1, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
});

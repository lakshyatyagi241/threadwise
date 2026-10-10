import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What a screen reader says for the box: the whole sentence the person agrees to. */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * A checkbox on its own: the sentence next to it is separate text, so it can carry links (the terms) that stay tappable. The tap
 * target is the 48 point square around the box.
 */
export function Checkbox({ checked, onChange, label, invalid, disabled }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={styles.target}
    >
      <View
        style={[
          styles.box,
          {
            backgroundColor: checked ? colors.primary : colors.surface,
            borderColor: invalid ? colors.danger : checked ? colors.primary : colors.borderStrong,
          },
        ]}
      >
        {checked ? <View style={[styles.tick, { borderColor: colors.onPrimary }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginStart: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: 6,
    height: 12,
    marginTop: -2,
    borderEndWidth: 2.5,
    borderBottomWidth: 2.5,
    transform: [{ rotate: '45deg' }],
  },
});

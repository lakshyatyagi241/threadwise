import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** What a screen reader says for the switch ("Rule X is active"); the state is read out after it. */
  label: string;
  disabled?: boolean;
  testID?: string;
}

const TRACK_WIDTH = 48;
const TRACK_HEIGHT = 28;
const THUMB = 22;
const PAD = 3;

/**
 * An on/off switch. The whole 48 point square around the track is the tap target; the thumb sits at the end when on (the end follows the
 * reading direction, so it flips in right-to-left languages). A screen reader hears it as a switch with the label and its state.
 */
export function Toggle({ value, onValueChange, label, disabled, testID }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      testID={testID}
      style={[styles.target, disabled && styles.faded]}
    >
      <View
        style={[
          styles.track,
          { backgroundColor: value ? colors.primary : colors.borderStrong },
          value ? styles.on : styles.off,
        ]}
      >
        <View style={[styles.thumb, { backgroundColor: colors.surface }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.5 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: PAD,
    justifyContent: 'center',
  },
  on: { alignItems: 'flex-end' },
  off: { alignItems: 'flex-start' },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
});

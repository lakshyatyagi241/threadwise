import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { TextField, type TextFieldProps } from './text-field';

/**
 * React Native swaps left and right corner radii in right-to-left languages but never a rotation, so the turn that makes the
 * almond lie flat has to follow the direction too (left-to-right: a quarter turn one way, right-to-left: the other).
 */
const EYE_TURN = I18nManager.isRTL ? '-45deg' : '45deg';

/** A text field for a password, with a switch at its end that shows or hides what was typed (people mistype on a small keyboard). */
export function PasswordField(props: Omit<TextFieldProps, 'secureTextEntry' | 'end'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!visible}
      end={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          onPress={() => setVisible((v) => !v)}
          style={styles.toggle}
        >
          <EyeIcon slashed={visible} color={colors.textMuted} />
        </Pressable>
      }
    />
  );
}

/** An eye, drawn with views so the app needs no icon font. Slashed means "tap to hide": the password is showing. */
function EyeIcon({ slashed, color }: { slashed: boolean; color: string }) {
  return (
    <View
      style={styles.iconBox}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.eye, { borderColor: color, transform: [{ rotate: EYE_TURN }] }]} />
      <View style={[styles.pupil, { backgroundColor: color }]} />
      {slashed ? <View style={[styles.slash, { backgroundColor: color }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingEnd: spacing.xs,
  },
  iconBox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // An almond: a square with two opposite corners fully rounded, turned so its two sharp corners face left and right.
  eye: {
    width: 17,
    height: 17,
    borderWidth: 2,
    borderTopLeftRadius: 17,
    borderBottomRightRadius: 17,
  },
  pupil: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },
  slash: {
    position: 'absolute',
    width: 28,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
});

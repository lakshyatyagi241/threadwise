import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useReducedMotion } from '@/components/ui/use-reduced-motion';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { checkPassword, type PasswordRuleId, type PolicyParts } from './password-rules';

/** The platform's password rules as a short list that fills in as the person types: a filled dot means the rule is met. */
export function PasswordChecklist({ password, parts }: { password: string; parts: PolicyParts }) {
  const { t } = useTranslation();
  const text = (id: PasswordRuleId): string => {
    switch (id) {
      case 'minLength':
        return t('signUp.passwordMinLength', { min: parts.min });
      case 'mixedCase':
        return t('signUp.passwordMixedCase');
      case 'number':
        return t('signUp.passwordNumber');
      case 'symbol':
        return t('signUp.passwordSymbol');
    }
  };
  return (
    <View style={styles.list}>
      {checkPassword(password, parts).map((rule) => (
        <View key={rule.id} style={styles.row} accessible accessibilityLabel={text(rule.id)}>
          <Dot met={rule.met} />
          <Text variant="caption" style={styles.text} color={rule.met ? 'text' : 'textMuted'}>
            {text(rule.id)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The marker of one rule. It gives a small pop the moment the rule becomes met, so progress is felt as well as seen. */
function Dot({ met }: { met: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!met || reduced) return;
    const pop = Animated.sequence([
      Animated.timing(scale, { toValue: 1.5, duration: 110, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]);
    pop.start();
    return () => pop.stop();
  }, [met, reduced, scale]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: met ? colors.primary : 'transparent',
          borderColor: met ? colors.primary : colors.borderStrong,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  text: { flex: 1 },
});

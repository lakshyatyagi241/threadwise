import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Icon, type IconName } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { Mode } from './appearance';
import { useSetMode } from './use-profile';

const MODES: readonly { mode: Mode; icon: IconName }[] = [
  { mode: 'light', icon: 'sunny-outline' },
  { mode: 'dark', icon: 'moon-outline' },
];

/**
 * Appearance: Light mode or Dark. The choice is saved to the account, so it survives a restart and a new phone; the screen
 * changes the moment a row is pressed. The tick shows what the app is using now, whether the person chose it or the phone did.
 */
export function AppearanceScreen() {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const setMode = useSetMode();
  const [failed, setFailed] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const choose = (mode: Mode) => {
    if (mode === scheme) return;
    setFailed(false);
    setMode.mutate(mode, { onError: () => setFailed(true) });
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.surface }]}>
      <StackHeader title={t('menu.appearance.title')} onBack={back} />
      {failed ? (
        <View style={styles.notice}>
          <Banner tone="danger" message={t('menu.appearance.failed')} />
        </View>
      ) : null}
      <View accessibilityRole="radiogroup">
        {MODES.map(({ mode, icon }) => {
          const selected = mode === scheme;
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={t(`menu.appearance.${mode}`)}
              accessibilityState={{ checked: selected }}
              onPress={() => choose(mode)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Icon name={icon} size={22} color="primary" />
              <Text style={styles.label}>{t(`menu.appearance.${mode}`)}</Text>
              {selected ? <Icon name="checkmark" size={22} color="primary" /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" muted style={styles.hint}>
        {t('menu.appearance.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
  hint: { padding: spacing.lg },
});

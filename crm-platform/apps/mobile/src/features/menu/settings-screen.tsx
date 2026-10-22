import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { OPEN, SETTINGS_ITEMS } from './settings-items';

const FADED = 0.4;
const BADGE = 44;
const ARROW = 32;

/**
 * The Settings page (route /settings), opened from the Settings row of the menu, as the Geta app does: one page listing the
 * workspace's setup screens, each with its icon and an arrow. A line the person may not open stays in the list, faded, and says why
 * when pressed.
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const [noAccess, setNoAccess] = useState(false);
  const allowed = (permission: string) => permission === OPEN || can(session.data, permission);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('menu.settings')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {noAccess ? (
          <View style={styles.notice}>
            <Banner tone="warning" message={t('menu.noAccess')} />
          </View>
        ) : null}
        <View style={{ backgroundColor: colors.surface }}>
          {SETTINGS_ITEMS.map((item) => {
            // While the session loads nothing is faded: a line is not "locked" before the answer is known.
            const faded = session.data !== undefined && !allowed(item.permission);
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={t(item.label)}
                accessibilityState={{ disabled: faded }}
                onPress={() => {
                  if (faded) {
                    setNoAccess(true);
                    return;
                  }
                  setNoAccess(false);
                  router.navigate(item.href);
                }}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.border, opacity: faded ? FADED : 1 },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: colors.primarySoft, borderColor: colors.primary },
                  ]}
                >
                  <Icon name={item.icon} size={22} color="primary" />
                </View>
                <Text variant="body" numberOfLines={1} style={styles.label}>
                  {t(item.label)}
                </Text>
                <View style={[styles.arrow, { backgroundColor: colors.background }]}>
                  <Icon name="chevron-forward" size={18} color="primary" />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  notice: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1 },
  arrow: {
    width: ARROW,
    height: ARROW,
    borderRadius: ARROW / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

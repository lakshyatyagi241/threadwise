import * as Linking from 'expo-linking';
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
import { useLegalLinks } from './use-legal-links';

const FADED = 0.4;

/**
 * Data & Security (route /data-security, from the menu), as in the Geta app: the Terms of Use and the Privacy Policy, which open in
 * the browser at the addresses the platform administrator set, and the request for account deletion, which is the app's own screen
 * (`/delete-account`). A policy with no address the app can open stays in the list, faded, and says so when pressed.
 */
export function DataSecurityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const links = useLegalLinks();
  const [unavailable, setUnavailable] = useState(false);

  const open = (url: string | null) => {
    if (!url) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    void Linking.openURL(url);
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('menu.dataSecurity')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      {unavailable ? (
        <View style={styles.notice}>
          <Banner tone="warning" message={t('dataSecurity.unavailable')} />
        </View>
      ) : null}
      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        <Row
          icon="document-text"
          label={t('dataSecurity.terms')}
          faded={links.terms === null}
          onPress={() => open(links.terms)}
        />
        <Row
          icon="shield-checkmark"
          label={t('dataSecurity.privacy')}
          faded={links.privacy === null}
          onPress={() => open(links.privacy)}
        />
        <Row
          icon="person-remove-outline"
          label={t('dataSecurity.deletion')}
          onPress={() => router.navigate('/delete-account')}
        />
      </View>
    </View>
  );
}

function Row({
  icon,
  label,
  faded,
  onPress,
}: {
  icon: IconName;
  label: string;
  faded?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: faded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: faded ? FADED : 1 },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name={icon} size={24} color="primary" />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { padding: spacing.lg },
  list: { marginTop: spacing.sm },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
});

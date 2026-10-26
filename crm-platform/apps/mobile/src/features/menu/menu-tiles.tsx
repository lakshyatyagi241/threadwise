import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const FADED = 0.4;

interface Tile {
  key: 'settings' | 'feedback' | 'notifications';
  icon: IconName;
  label: string;
  faded: boolean;
  onPress: () => void;
}

interface Props {
  /** A tile whose page the person may not open stays, faded; pressing it still calls its `onPress` so the screen can say why. */
  settingsFaded: boolean;
  feedbackFaded: boolean;
  onSettings: () => void;
  onFeedback: () => void;
  onNotifications: () => void;
}

/**
 * The top of the Menu: three rounded tiles side by side, an icon over a short name, on the page's soft background: Settings,
 * Feedback and Notifications. They replace the rows those pages had in the list below.
 */
export function MenuTiles({
  settingsFaded,
  feedbackFaded,
  onSettings,
  onFeedback,
  onNotifications,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tiles: Tile[] = [
    {
      key: 'settings',
      icon: 'settings-outline',
      label: t('menu.settings'),
      faded: settingsFaded,
      onPress: onSettings,
    },
    {
      key: 'feedback',
      icon: 'chatbox-ellipses-outline',
      label: t('menu.feedback'),
      faded: feedbackFaded,
      onPress: onFeedback,
    },
    {
      key: 'notifications',
      icon: 'notifications-outline',
      label: t('notifications.title'),
      faded: false,
      onPress: onNotifications,
    },
  ];
  return (
    <View style={[styles.band, { backgroundColor: colors.background }]}>
      {tiles.map((tile) => (
        <Pressable
          key={tile.key}
          accessibilityRole="button"
          accessibilityLabel={tile.label}
          accessibilityState={{ disabled: tile.faded }}
          onPress={tile.onPress}
          style={({ pressed }) => [
            styles.tile,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: tile.faded ? FADED : 1,
            },
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Icon name={tile.icon} size={28} color="action" />
          <Text variant="label" numberOfLines={1} style={styles.label}>
            {tile.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
  tile: {
    flex: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  label: { textAlign: 'center' },
});

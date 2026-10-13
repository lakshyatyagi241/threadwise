import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export interface ThreadMenuItem {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  items: readonly ThreadMenuItem[];
  onClose: () => void;
}

/** The short list the three dots of a thread open: what can be done with the conversation right now. */
export function ThreadMenu({ visible, items, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.thread.menu.close')}
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
      >
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Icon name={item.icon} size={20} color="primary" />
              <Text variant="body">{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'flex-end', paddingTop: 96, paddingHorizontal: spacing.lg },
  card: {
    minWidth: 240,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});

import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type AttachSource = 'library' | 'camera' | 'document';

const OPTIONS: readonly { source: AttachSource; icon: IconName }[] = [
  { source: 'library', icon: 'image-outline' },
  { source: 'camera', icon: 'camera-outline' },
  { source: 'document', icon: 'document-outline' },
];

interface Props {
  visible: boolean;
  onChoose: (source: AttachSource) => void;
  onClose: () => void;
  /** iOS only: the sheet has finished leaving the screen. A picker cannot be shown before that, so the choice waits for it. */
  onDismiss?: () => void;
}

/** The sheet under the paperclip: photo or video from the library, the camera, or a document. Picking one closes the sheet; the file is chosen after it has gone. */
export function AttachMenu({ visible, onChoose, onClose, onDismiss }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={styles.fill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inbox.attach.close')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {t('inbox.attach.title')}
          </Text>
          {OPTIONS.map(({ source, icon }) => (
            <Pressable
              key={source}
              accessibilityRole="button"
              accessibilityLabel={t(`inbox.attach.${source}`)}
              onPress={() => onChoose(source)}
              style={({ pressed }) => [
                styles.row,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Icon name={icon} size={24} color="primary" />
              <Text>{t(`inbox.attach.${source}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

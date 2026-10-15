import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { MediaSource } from './use-media-source';

interface Props {
  source: MediaSource;
  visible: boolean;
  onClose: () => void;
}

/**
 * A picture of a message at the size of the screen, on a dark backdrop. The source is the one the thread already loaded (it carries
 * the signed-in person's token as a header), so nothing new is requested for the token. The close button and the Android back button
 * both close it; the backdrop is the theme's darkest colour in either theme, because a photo is judged on a dark ground.
 */
export function PictureViewer({ source, visible, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.shadow }]} accessibilityViewIsModal>
        {/* A list of one: React Native 0.86 on Android drops the headers of a single-object source (see Picture). */}
        <Image
          testID="picture-viewer-image"
          source={[source]}
          accessible
          accessibilityLabel={t('inbox.thread.pictureFull')}
          resizeMode="contain"
          style={styles.image}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inbox.thread.pictureClose')}
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { top: insets.top + spacing.sm }]}
        >
          <Icon name="close" size={26} color="onBrand" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  image: { flex: 1 },
  close: {
    position: 'absolute',
    right: spacing.md,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

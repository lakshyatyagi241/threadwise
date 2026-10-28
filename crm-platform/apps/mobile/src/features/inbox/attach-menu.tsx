import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type AttachSource = 'camera' | 'photo' | 'video' | 'audio' | 'document';

/** The ways to attach a file, in the order the Geta app lists them. */
const OPTIONS: readonly { source: AttachSource; icon: IconName }[] = [
  { source: 'camera', icon: 'camera' },
  { source: 'photo', icon: 'image' },
  { source: 'video', icon: 'videocam' },
  { source: 'audio', icon: 'headset' },
  { source: 'document', icon: 'document-text' },
];

/** One more tile after the ways to attach a file: the other things the "+" of the message box opens (saved replies, templates, emoji). */
export interface PlusExtra {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
}

/** Tiles in a row. Four is what a phone fits with a label under each; a long label wraps onto a second line. */
const COLUMNS = 4;
const TILE = 64;

interface Props {
  visible: boolean;
  onChoose: (source: AttachSource) => void;
  onClose: () => void;
  /** iOS only: the sheet has finished leaving the screen. A picker cannot be shown before that, so the choice waits for it. */
  onDismiss?: () => void;
  /** Tiles after the attach choices; each closes the sheet and then does its work (a sheet cannot open on top of this one). */
  extras?: readonly PlusExtra[];
}

/**
 * The sheet under the "+" of the message box, laid out like the Geta app's: a grid of rounded icon tiles with the name under each
 * (Camera, Photo, Video, Audio, Document), then saved replies, templates and emoji. Picking one closes the sheet; the file is chosen
 * after it has gone.
 */
export function AttachMenu({ visible, onChoose, onClose, onDismiss, extras = [] }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // iOS shows a new sheet only after this one has gone (onDismiss); Android has no such event, so the work starts at once.
  const waiting = useRef<(() => void) | null>(null);
  const chooseExtra = (extra: PlusExtra) => {
    onClose();
    if (Platform.OS === 'ios') waiting.current = extra.onPress;
    else extra.onPress();
  };
  const tiles: { key: string; label: string; icon: IconName; onPress: () => void }[] = [
    ...OPTIONS.map(({ source, icon }) => ({
      key: source,
      label: t(`inbox.attach.${source}`),
      icon,
      onPress: () => onChoose(source),
    })),
    ...extras.map((extra) => ({ ...extra, onPress: () => chooseExtra(extra) })),
  ];
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={() => {
        onDismiss?.();
        const next = waiting.current;
        waiting.current = null;
        next?.();
      }}
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
          accessibilityLabel={t('inbox.attach.title')}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.grid}>
            {tiles.map((tile) => (
              <Pressable
                key={tile.key}
                accessibilityRole="button"
                accessibilityLabel={tile.label}
                onPress={tile.onPress}
                style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6 }]}
              >
                <View
                  style={[
                    styles.tile,
                    { backgroundColor: colors.primarySoft, borderColor: colors.border },
                  ]}
                >
                  <Icon name={tile.icon} size={28} color="primary" />
                </View>
                <Text variant="body" numberOfLines={2} style={styles.label}>
                  {tile.label}
                </Text>
              </Pressable>
            ))}
          </View>
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
    paddingHorizontal: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginVertical: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: spacing.sm },
  cell: {
    width: `${100 / COLUMNS}%`,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});

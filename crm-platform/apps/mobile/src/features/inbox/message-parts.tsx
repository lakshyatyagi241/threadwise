import type {
  MessageContactCard,
  MessageLocation,
  MessageMedia,
  MessageTemplateButton,
} from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { PictureViewer } from './picture-viewer';
import { useMediaSource } from './use-media-source';

const PICTURE_WIDTH = 240;
/** Until the picture says how big it is, and the most and least tall one that is drawn (a very tall photo is cropped, not stretched). */
const PICTURE_RATIO = 4 / 3;
const PICTURE_MIN_HEIGHT = 120;
const PICTURE_MAX_HEIGHT = 320;

/** A grey tile with an icon and a line of words: a file that is not shown as a picture, or a picture that cannot be. */
export function FileTile({
  icon,
  label,
  detail,
}: {
  icon: IconName;
  label: string;
  detail?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
      <Icon name={icon} size={24} color="textMuted" />
      <View style={styles.tileText}>
        <Text variant="label" numberOfLines={2}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" muted numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "123 KB", "4.2 MB": the size of a file as people read it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/**
 * A picture of a message. Its link was made for the signed-in person, so the request carries their token; until the token is
 * read, or when the picture cannot be loaded, a tile with the word for it stands in.
 */
export function Picture({ media, fallback }: { media: MessageMedia; fallback: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const source = useMediaSource(media.url);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // Drawn at its own proportions: the width is fixed, and the height follows once the picture has said how big it is.
  const [ratio, setRatio] = useState(PICTURE_RATIO);
  const height = Math.round(
    Math.min(PICTURE_MAX_HEIGHT, Math.max(PICTURE_MIN_HEIGHT, PICTURE_WIDTH / ratio)),
  );
  if (!source || failed) return <FileTile icon="image-outline" label={fallback} />;
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={t('inbox.thread.pictureOpen')}
        onPress={() => setOpen(true)}
      >
        <Image
          testID="message-picture"
          // A list of one: React Native 0.86 on Android sends the headers of a source only when it is given as a list, and silently
          // drops them for a single object (the picture would be refused with 401 and never show).
          source={[source]}
          accessible={false}
          resizeMode="cover"
          onLoad={(event) => {
            const { width, height: tall } = event.nativeEvent.source;
            if (width > 0 && tall > 0) setRatio(width / tall);
          }}
          onError={() => setFailed(true)}
          style={[styles.picture, { height, backgroundColor: colors.surfaceMuted }]}
        />
      </Pressable>
      <PictureViewer source={source} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Where a place message points: its name and address. */
export function Place({ location }: { location: MessageLocation }) {
  const lines = [location.name, location.address].filter(Boolean);
  return (
    <FileTile
      icon="location-outline"
      label={lines[0] ?? `${location.latitude}, ${location.longitude}`}
      detail={lines[1] ?? null}
    />
  );
}

/** Shared contact cards: a name and the numbers under it. */
export function ContactCards({ cards }: { cards: readonly MessageContactCard[] }) {
  return (
    <>
      {cards.map((card, i) => (
        <FileTile
          key={i}
          icon="person-outline"
          label={card.name ?? card.phones[0] ?? ''}
          detail={card.phones.join(', ')}
        />
      ))}
    </>
  );
}

const BUTTON_ICON: Record<MessageTemplateButton['type'], IconName | null> = {
  quick_reply: null,
  url: 'link-outline',
  phone: 'call-outline',
  copy_code: 'copy-outline',
  other: null,
};

/** The icon for a button of a template, as WhatsApp draws it. */
export const iconForButton = (type: MessageTemplateButton['type']): IconName | null =>
  BUTTON_ICON[type];

export interface BubbleButton {
  key: string;
  label: string;
  icon?: IconName | null;
  /** A link the person can open; without one the button is only drawn (a template does not say where it goes). */
  url?: string | null;
}

/** Only web links are opened from a message: never another app's scheme. */
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/** The buttons under a message, one full-width row each, as they look to the customer. */
export function ButtonRows({ buttons }: { buttons: readonly BubbleButton[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.buttons}>
      {buttons.map((button) => {
        const content = (
          <>
            {button.icon ? <Icon name={button.icon} size={16} color="textMuted" /> : null}
            <Text variant="label" numberOfLines={1}>
              {button.label}
            </Text>
          </>
        );
        const style = [styles.button, { backgroundColor: colors.surfaceMuted }];
        return button.url && isWebLink(button.url) ? (
          <Pressable
            key={button.key}
            accessibilityRole="link"
            accessibilityLabel={button.label}
            onPress={() => void Linking.openURL(button.url as string)}
            style={style}
          >
            {content}
          </Pressable>
        ) : (
          <View key={button.key} accessible accessibilityLabel={button.label} style={style}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

/** What a placeholder says while a file is still being copied, or when it could not be. */
export function MediaNotice({ state }: { state: 'pending' | 'failed' }) {
  const { t } = useTranslation();
  return (
    <FileTile
      icon={state === 'pending' ? 'time-outline' : 'alert-circle-outline'}
      label={t(state === 'pending' ? 'inbox.message.mediaPending' : 'inbox.message.mediaFailed')}
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 180,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  tileText: { flex: 1 },
  picture: { width: PICTURE_WIDTH, borderRadius: radius.sm },
  buttons: { gap: spacing.xs, marginTop: spacing.sm },
  button: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
});

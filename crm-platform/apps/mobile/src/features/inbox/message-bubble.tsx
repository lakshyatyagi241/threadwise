import type { MessageKind, MessageResponse, MessageStatus } from '@crm/contracts';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  ButtonRows,
  ContactCards,
  FileTile,
  formatBytes,
  iconForButton,
  MediaNotice,
  Picture,
  Place,
  type BubbleButton,
} from './message-parts';
import { formatClock } from './time';

const STATUS_ICON: Record<MessageStatus, IconName | null> = {
  received: null,
  queued: 'time-outline',
  sent: 'checkmark',
  delivered: 'checkmark-done',
  read: 'checkmark-done',
  failed: 'alert-circle',
};

/** The icon of a file that is not a picture. */
const FILE_ICON: Partial<Record<MessageKind, IconName>> = {
  video: 'videocam-outline',
  audio: 'musical-notes-outline',
  voice: 'mic-outline',
  document: 'document-text-outline',
  sticker: 'happy-outline',
};

interface Props {
  direction: 'in' | 'out';
  /** What the bubble says. Null: nothing to show but the placeholder for the kind. */
  text: string | null;
  /** The word for what this message is (a photo, a template...): read by a screen reader, and written when nothing better is drawn. */
  kindLabel?: string | null;
  /** False when the message is drawn for real (a picture, a template), so the word would only repeat it. */
  showKindLabel?: boolean;
  /** Drawn above the text: a picture, a file, the header of a template. */
  top?: ReactNode;
  /** A small grey line under the text (the footer of a template). */
  footer?: string | null;
  /** Buttons under the message. */
  buttons?: readonly BubbleButton[];
  status: MessageStatus;
  /** ISO time of the message, when known. */
  at: string | null;
  /** Shown under a failed bubble. */
  onRetry?: () => void;
  testID?: string;
}

/** One message: incoming on the left, outgoing on the right, with the time and (for ours) how far delivery got. */
export function Bubble({
  direction,
  text,
  kindLabel,
  showKindLabel = true,
  top,
  footer,
  buttons,
  status,
  at,
  onRetry,
  testID,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const out = direction === 'out';
  const time = at ? formatClock(at, t) : '';
  const shown = [kindLabel, text].filter(Boolean).join(': ');
  const statusWord = t(`inbox.delivery.${status}`);
  const label = out
    ? t('inbox.message.labelOut', { text: shown, time, status: statusWord })
    : t('inbox.message.labelIn', { text: shown, time });
  const icon = out ? STATUS_ICON[status] : null;
  const iconColor = status === 'failed' ? 'danger' : status === 'read' ? 'primary' : 'textMuted';

  return (
    <View style={[styles.row, out ? styles.rowOut : styles.rowIn]}>
      <View
        style={[styles.bubble, { backgroundColor: out ? colors.primarySoft : colors.surfaceMuted }]}
      >
        <View testID={testID} accessible accessibilityLabel={label} style={styles.content}>
          {top}
          {kindLabel && showKindLabel ? (
            <Text variant="label" muted>
              {kindLabel}
            </Text>
          ) : null}
          {text ? <Text>{text}</Text> : null}
          {footer ? (
            <Text variant="caption" muted>
              {footer}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <Text variant="caption" muted>
              {time}
            </Text>
            {icon ? <Icon name={icon} size={14} color={iconColor} /> : null}
          </View>
        </View>
        {buttons && buttons.length > 0 ? <ButtonRows buttons={buttons} /> : null}
      </View>
      {status === 'failed' && onRetry ? (
        <Button variant="link" label={t('inbox.message.retry')} onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** A message from the API, drawn as the customer sees it: its picture or file, a template's header, footer and buttons. */
export function MessageBubble({
  message,
  onRetry,
}: {
  message: MessageResponse;
  onRetry?: (message: MessageResponse) => void;
}) {
  const { t } = useTranslation();
  const deleted = message.deletedAt !== null;
  const kindWord = t(`inbox.kind.${message.kind}`);
  const drawn = deleted ? null : drawMessage(message, kindWord, t);
  return (
    <Bubble
      testID={`message-${message.seq}`}
      direction={message.direction}
      text={deleted ? t('inbox.message.deleted') : message.body}
      kindLabel={!deleted && message.kind !== 'text' ? kindWord : null}
      showKindLabel={drawn === null || !drawn.replacesLabel}
      top={drawn?.top}
      footer={drawn?.footer}
      buttons={drawn?.buttons}
      status={message.status}
      at={message.sentAt ?? message.createdAt}
      onRetry={onRetry ? () => onRetry(message) : undefined}
    />
  );
}

interface Drawn {
  top?: ReactNode;
  footer?: string | null;
  buttons?: readonly BubbleButton[];
  /** The message is drawn for real, so the word for its kind is not written as well. */
  replacesLabel: boolean;
}

/** The icon for what a template's header is made of (a file is not stored with the message, so a tile stands for it). */
const HEADER_ICON = {
  image: 'image-outline',
  video: 'videocam-outline',
  document: 'document-text-outline',
  location: 'location-outline',
} as const satisfies Record<string, IconName>;

/** What to draw for a message beyond its words, or null when there is nothing more than the text and the word for its kind. */
function drawMessage(message: MessageResponse, kindWord: string, t: TFunction): Drawn | null {
  const media = message.media;
  if (message.mediaState === 'pending' || message.mediaState === 'failed') {
    return { top: <MediaNotice state={message.mediaState} />, replacesLabel: true };
  }
  if (media && (message.kind === 'image' || message.kind === 'sticker')) {
    return { top: <Picture media={media} fallback={kindWord} />, replacesLabel: true };
  }
  if (media) {
    const detail = [media.sizeBytes !== null ? formatBytes(media.sizeBytes) : null, media.mime]
      .filter(Boolean)
      .join(' · ');
    return {
      top: (
        <FileTile
          icon={FILE_ICON[message.kind] ?? 'document-outline'}
          label={media.name ?? kindWord}
          detail={detail}
        />
      ),
      replacesLabel: true,
    };
  }
  if (message.location) return { top: <Place location={message.location} />, replacesLabel: true };
  if (message.contacts && message.contacts.length > 0) {
    return { top: <ContactCards cards={message.contacts} />, replacesLabel: true };
  }
  const template = message.template?.preview;
  if (template) {
    const header = template.header;
    let top: ReactNode;
    if (header?.format === 'text') {
      top = header.text ? <Text variant="label">{header.text}</Text> : undefined;
    } else if (header) {
      top = <FileTile icon={HEADER_ICON[header.format]} label={t(`inbox.kind.${header.format}`)} />;
    }
    return {
      top,
      footer: template.footer,
      buttons: template.buttons.map((b, i) => ({
        key: `${i}-${b.text}`,
        label: b.text,
        icon: iconForButton(b.type),
      })),
      replacesLabel: true,
    };
  }
  const sent = message.sentInteractive;
  if (sent) {
    return {
      top: sent.header ? <Text variant="label">{sent.header}</Text> : undefined,
      footer: sent.footer,
      buttons: sent.buttons.map((b, i) => ({
        key: `${i}-${b.title}`,
        label: b.title,
        icon: b.url ? 'link-outline' : null,
        url: b.url,
      })),
      replacesLabel: true,
    };
  }
  return null;
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: 2, maxWidth: '100%' },
  rowIn: { alignItems: 'flex-start' },
  rowOut: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: { gap: spacing.xs },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: spacing.xs },
});

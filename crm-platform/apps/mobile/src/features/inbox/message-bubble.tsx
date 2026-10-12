import type { MessageResponse, MessageStatus } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatClock } from './time';

const STATUS_ICON: Record<MessageStatus, IconName | null> = {
  received: null,
  queued: 'time-outline',
  sent: 'checkmark',
  delivered: 'checkmark-done',
  read: 'checkmark-done',
  failed: 'alert-circle',
};

interface Props {
  direction: 'in' | 'out';
  /** What the bubble says. Null: nothing to show but the placeholder for the kind. */
  text: string | null;
  /** A placeholder for what this app cannot show yet (a photo, a template...). */
  kindLabel?: string | null;
  status: MessageStatus;
  /** ISO time of the message, when known. */
  at: string | null;
  /** Shown under a failed bubble. */
  onRetry?: () => void;
  testID?: string;
}

/** One message: incoming on the left, outgoing on the right, with the time and (for ours) how far delivery got. */
export function Bubble({ direction, text, kindLabel, status, at, onRetry, testID }: Props) {
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
        testID={testID}
        accessible
        accessibilityLabel={label}
        style={[styles.bubble, { backgroundColor: out ? colors.primarySoft : colors.surfaceMuted }]}
      >
        {kindLabel ? (
          <Text variant="label" muted>
            {kindLabel}
          </Text>
        ) : null}
        {text ? <Text>{text}</Text> : null}
        <View style={styles.meta}>
          <Text variant="caption" muted>
            {time}
          </Text>
          {icon ? <Icon name={icon} size={14} color={iconColor} /> : null}
        </View>
      </View>
      {status === 'failed' && onRetry ? (
        <Button variant="link" label={t('inbox.message.retry')} onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** A message from the API. */
export function MessageBubble({
  message,
  onRetry,
}: {
  message: MessageResponse;
  onRetry?: (message: MessageResponse) => void;
}) {
  const { t } = useTranslation();
  const deleted = message.deletedAt !== null;
  return (
    <Bubble
      testID={`message-${message.seq}`}
      direction={message.direction}
      text={deleted ? t('inbox.message.deleted') : message.body}
      kindLabel={!deleted && message.kind !== 'text' ? t(`inbox.kind.${message.kind}`) : null}
      status={message.status}
      at={message.sentAt ?? message.createdAt}
      onRetry={onRetry ? () => onRetry(message) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: 2, maxWidth: '100%' },
  rowIn: { alignItems: 'flex-start' },
  rowOut: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: spacing.xs },
});

import type { InboxConversationDetail } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { channelMark } from './channel-badge';
import { STATUS_TONE } from './status';
import { ThreadMenu, type ThreadMenuItem } from './thread-menu';
import { WindowTimer } from './window-timer';

/** The words for each channel kind, so the header says "WhatsApp" and not the name someone gave the connection. */
const CHANNEL_LABEL = {
  whatsapp_cloud: 'inbox.channel.whatsapp',
  whatsapp_qr: 'inbox.channel.whatsapp',
  webchat: 'inbox.channel.webchat',
  telegram: 'inbox.channel.telegram',
  facebook: 'inbox.channel.facebook',
  instagram: 'inbox.channel.instagram',
  simulator: 'inbox.channel.simulator',
} as const;

interface Props {
  conversation: InboxConversationDetail | undefined;
  /** The clock the reply-window timer counts down against. */
  now: Date;
  onBack: () => void;
  /** The one-tap action beside the three dots (resolve, or reopen); null when the person may not or it does not apply. */
  primary: { icon: IconName; label: string; onPress: () => void } | null;
  menu: readonly ThreadMenuItem[];
}

/**
 * The top of a thread: back, the person's avatar and name, which channel the chat is on (its logo and name), the reply-window
 * timer, the resolve button and the three dots. A thread that is not open also says so next to the channel.
 */
export function ThreadHeader({ conversation, now, onBack, primary, menu }: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const mark = conversation ? channelMark(conversation.channel.kind) : null;
  const labelKey = conversation
    ? CHANNEL_LABEL[conversation.channel.kind as keyof typeof CHANNEL_LABEL]
    : undefined;

  return (
    <ScreenHeader
      actions={
        conversation ? (
          <>
            <WindowTimer
              expiresAt={conversation.window.expiresAt}
              windowHours={conversation.capabilities.windowHours}
              now={now}
            />
            {primary ? (
              <HeaderIconButton
                icon={primary.icon}
                label={primary.label}
                onPress={primary.onPress}
              />
            ) : null}
            {menu.length > 0 ? (
              <HeaderIconButton
                icon="ellipsis-vertical"
                label={t('inbox.thread.menu.open')}
                onPress={() => setMenuOpen(true)}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      <View style={styles.row}>
        <HeaderIconButton icon="arrow-back" label={t('common.back')} onPress={onBack} />
        {conversation && mark ? (
          <>
            <Avatar name={conversation.title} seed={conversation.id} size={44} />
            <View style={styles.text}>
              <Text variant="subheading" numberOfLines={1} accessibilityRole="header">
                {conversation.title}
              </Text>
              <View style={styles.channel}>
                <Icon name={mark.icon} size={16} color={mark.color} />
                <Text variant="caption" muted numberOfLines={1} style={styles.channelName}>
                  {labelKey ? t(labelKey) : conversation.channel.name}
                </Text>
                {conversation.status !== 'open' ? (
                  <Badge
                    label={t(`inbox.status.${conversation.status}`)}
                    tone={STATUS_TONE[conversation.status]}
                  />
                ) : null}
              </View>
            </View>
          </>
        ) : null}
      </View>
      <ThreadMenu visible={menuOpen} items={menu} onClose={() => setMenuOpen(false)} />
    </ScreenHeader>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, gap: 2 },
  channel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  channelName: { flexShrink: 1 },
});

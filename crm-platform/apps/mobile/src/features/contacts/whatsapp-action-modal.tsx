import type { ChannelResponse, ContactResponse } from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { fetchWhatsappNumbers, openConversation } from './chat-api';
import { displayName } from './contact-display';
import { whatsappLink } from './whatsapp-link';

interface Props {
  contact: ContactResponse;
  onClose: () => void;
}

/**
 * What the WhatsApp shortcut of a contact asks first (the Geta app's "WhatsApp Action"): open the WhatsApp app on the contact's
 * number, or send an approved template. A template goes through the inbox: the contact's thread on one of the workspace's connected
 * WhatsApp numbers is opened (made, when there is none) and the template pages take over. With more than one number the person
 * says which; with none, or without the inbox permissions, the row says why it cannot be used.
 */
export function WhatsappActionModal({ contact, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [numbers, setNumbers] = useState<ChannelResponse[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const link = whatsappLink(contact.phone);
  const canTemplate =
    link !== null &&
    can(session.data, 'inbox.conversation.read') &&
    can(session.data, 'inbox.conversation.reply');

  const openApp = () => {
    if (!link) return;
    void Linking.openURL(link);
    onClose();
  };

  const startTemplate = async (channelId: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const thread = await openConversation(contact.id, channelId);
      onClose();
      router.push({ pathname: '/template-picker', params: { id: thread.id } });
    } catch (error) {
      setProblem(messageForError(error, t));
    } finally {
      setBusy(false);
    }
  };

  const chooseTemplate = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const list = await fetchWhatsappNumbers();
      if (list.length === 0) {
        setProblem(t('contacts.whatsappAction.noNumber'));
        setBusy(false);
        return;
      }
      if (list.length === 1) {
        await startTemplate(list[0]!.id);
        return;
      }
      setNumbers(list);
      setBusy(false);
    } catch (error) {
      setProblem(messageForError(error, t));
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('contacts.sheet.close')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surface }]}
        >
          <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
            <Icon name="logo-whatsapp" size={32} color="whatsapp" />
          </View>
          <Text variant="heading" style={styles.center} accessibilityRole="header">
            {t('contacts.whatsappAction.title')}
          </Text>
          <Text variant="body" muted style={styles.center}>
            {numbers
              ? t('contacts.whatsappAction.pickNumber')
              : t('contacts.whatsappAction.subtitle', { name: displayName(contact, t) })}
          </Text>
          {problem ? <Banner tone="danger" message={problem} /> : null}

          {numbers ? (
            numbers.map((number) => (
              <Choice
                key={number.id}
                icon="logo-whatsapp"
                title={number.name}
                hint={number.displayAddress ?? undefined}
                disabled={busy}
                onPress={() => void startTemplate(number.id)}
              />
            ))
          ) : (
            <>
              <Choice
                icon="logo-whatsapp"
                title={t('contacts.whatsappAction.open')}
                hint={t('contacts.whatsappAction.openHint')}
                disabled={!link || busy}
                onPress={openApp}
              />
              <Choice
                icon="chatbox-ellipses"
                title={t('inbox.template.send')}
                hint={t('contacts.whatsappAction.templateHint')}
                disabled={!canTemplate || busy}
                onPress={() => void chooseTemplate()}
                purple
              />
            </>
          )}
          {busy ? <ActivityIndicator accessibilityLabel={t('common.loading')} /> : null}
          <Button variant="link" label={t('contacts.cancel')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Choice({
  icon,
  title,
  hint,
  disabled,
  purple,
  onPress,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  disabled?: boolean;
  purple?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        { backgroundColor: colors.background, borderColor: colors.border },
        disabled && styles.faded,
      ]}
    >
      <View
        style={[
          styles.choiceIcon,
          { backgroundColor: purple ? colors.primarySoft : colors.successSoft },
        ]}
      >
        <Icon name={icon} size={24} color={purple ? 'primary' : 'whatsapp'} />
      </View>
      <View style={styles.grow}>
        <Text variant="label">{title}</Text>
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.xl },
  badge: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  faded: { opacity: 0.4 },
});

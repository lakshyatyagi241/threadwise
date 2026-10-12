import type { ContactResponse } from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { findConversationId } from './chat-api';
import type { ContactAction } from './contact-actions';

/**
 * The six shortcuts for one contact: call, chat, email, text, tasks, notes. Call, text and email hand over to the phone's own apps.
 * Chat opens the inbox thread when there is one. `onNotice` receives a sentence to show when it cannot (no thread yet, or a failure),
 * and null when a new try starts.
 */
export function useContactActions(
  contact: ContactResponse | null,
  onNotice: (message: string | null) => void,
): ContactAction[] {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const [looking, setLooking] = useState(false);
  if (!contact) return [];

  const phone = contact.phone;
  const open = (url: string) => void Linking.openURL(url);
  const openChat = async () => {
    onNotice(null);
    setLooking(true);
    try {
      const threadId = await findConversationId({ id: contact.id, phone });
      if (threadId) router.push({ pathname: '/conversation/[id]', params: { id: threadId } });
      else onNotice(t('contacts.detail.chatNone'));
    } catch (error) {
      onNotice(messageForError(error, t));
    } finally {
      setLooking(false);
    }
  };

  return [
    {
      key: 'call',
      icon: 'call-outline',
      label: t('contacts.detail.actions.call'),
      disabled: !phone,
      onPress: () => open(`tel:${phone}`),
    },
    {
      key: 'chat',
      icon: 'chatbubble-ellipses-outline',
      label: t('contacts.detail.actions.chat'),
      disabled: !phone || !can(session.data, 'inbox.conversation.read'),
      busy: looking,
      onPress: () => void openChat(),
    },
    {
      key: 'email',
      icon: 'mail-outline',
      label: t('contacts.detail.actions.email'),
      disabled: !contact.email,
      onPress: () => open(`mailto:${contact.email}`),
    },
    {
      key: 'sms',
      icon: 'chatbox-outline',
      label: t('contacts.detail.actions.sms'),
      disabled: !phone,
      onPress: () => open(`sms:${phone}`),
    },
    {
      key: 'tasks',
      icon: 'checkbox-outline',
      label: t('contacts.detail.actions.tasks'),
      disabled: !can(session.data, 'record.tasks.read'),
      onPress: () => router.push({ pathname: '/tasks', params: { contactId: contact.id } }),
    },
    {
      key: 'notes',
      icon: 'document-text-outline',
      label: t('contacts.detail.actions.notes'),
      onPress: () => router.push({ pathname: '/contact-notes', params: { contactId: contact.id } }),
    },
  ];
}

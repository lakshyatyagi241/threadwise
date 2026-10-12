import type { ContactResponse } from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { findConversationId } from './chat-api';
import type { ContactAction } from './contact-actions';
import { whatsappLink } from './whatsapp-link';

/**
 * The six shortcuts for one contact: call, chat, email, text, tasks, notes. Call, text and email hand over to the phone's own apps.
 * Chat opens the inbox thread when there is one; when there is none (the API cannot start a thread from here), or the person may
 * not read the inbox, it opens the contact's WhatsApp chat, as the web's shortcut does. `onNotice` receives a sentence to show when
 * the thread could not be looked up, and null when a new try starts.
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
  const openWhatsapp = () => {
    const link = whatsappLink(phone);
    if (link) open(link);
  };
  const openChat = async () => {
    onNotice(null);
    // No inbox to look in: the contact's own WhatsApp is the chat.
    if (!can(session.data, 'inbox.conversation.read')) {
      openWhatsapp();
      return;
    }
    setLooking(true);
    try {
      const threadId = await findConversationId({ id: contact.id, phone });
      if (threadId) router.push({ pathname: '/conversation/[id]', params: { id: threadId } });
      else openWhatsapp();
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
      disabled: !phone,
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

import { channelListResponseSchema, conversationListResponseSchema } from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/** The inbox search only matches a number when at least this many digits are typed. */
const MIN_DIGITS = 3;

/**
 * The inbox thread that already exists for this contact, or null. There is no staff route that opens a thread for a contact (the
 * API can only do that for its developer API), so a chat is found by searching the inbox for the contact's number and keeping the
 * thread that belongs to this contact: the one linked to the contact, else a WhatsApp thread with exactly that number (a thread
 * can exist before it is linked to a contact record). A contact who was never written to or never wrote has no thread, and this
 * says so.
 */
export async function findConversationId(
  contact: { id: string; phone: string | null },
  signal?: AbortSignal,
): Promise<string | null> {
  const digits = (contact.phone ?? '').replace(/\D/g, '');
  if (digits.length < MIN_DIGITS) return null;
  const page = await apiFetch('/v2/inbox/conversations', {
    query: { q: digits, status: 'all', limit: 50 },
    schema: conversationListResponseSchema,
    signal,
  });
  const mine =
    page.data.find((thread) => thread.contact?.id === contact.id) ??
    page.data.find(
      (thread) =>
        thread.channel.kind.startsWith('whatsapp') && thread.peerKey.replace(/\D/g, '') === digits,
    );
  return mine?.id ?? null;
}

/** The workspace's WhatsApp numbers that are connected: where a template to a contact can be sent from (`inbox.conversation.read`). */
export async function fetchWhatsappNumbers(signal?: AbortSignal) {
  const list = await apiFetch('/v2/channels', { schema: channelListResponseSchema, signal });
  return list.data.filter((c) => c.status === 'connected' && c.kind.startsWith('whatsapp'));
}

/**
 * Opens, or creates, the contact's thread on one WhatsApp number (`inbox.conversation.reply`), the route the web's single send uses.
 * The API answers 422 when the number cannot start a thread or the contact has no phone; the first message outside the 24-hour
 * window must be a template, which is why "Send Template" goes through here.
 */
export const openConversation = (contactId: string, channelId: string, signal?: AbortSignal) =>
  apiFetch('/v2/inbox/conversations/open', {
    method: 'POST',
    body: { contactId, channelId },
    schema: z.object({ id: z.string().uuid() }),
    signal,
  });

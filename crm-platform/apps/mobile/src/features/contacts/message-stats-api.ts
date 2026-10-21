import { contactMessageStatsSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The WhatsApp summary of one contact: how many messages were sent to it, delivered, seen, answered or failed, and how many it sent,
 * counted by the API over the contact's WhatsApp conversations. Needs `inbox.conversation.read`.
 */
export const getContactMessageStats = (contactId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${encodeURIComponent(contactId)}/message-stats/whatsapp`, {
    schema: contactMessageStatsSchema,
    signal,
  });

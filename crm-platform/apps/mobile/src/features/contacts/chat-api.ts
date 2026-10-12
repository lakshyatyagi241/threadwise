import { conversationListResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** The inbox search only matches a number when at least this many digits are typed. */
const MIN_DIGITS = 3;

/**
 * The inbox thread that already exists for this contact, or null. There is no staff route that opens a thread for a contact (the
 * API can only do that for its developer API), so a chat is found by searching the inbox for the contact's number and keeping the
 * thread that belongs to this contact. A contact who was never written to or never wrote has no thread, and this says so.
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
  return page.data.find((thread) => thread.contact?.id === contact.id)?.id ?? null;
}

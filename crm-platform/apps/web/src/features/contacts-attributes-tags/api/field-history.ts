'use client';

import { fieldHistoryEntrySchema } from '@crm/contracts';
import { useCursorList } from '@/lib/api/use-cursor-list';

export const FIELD_HISTORY_KEY = (contactId: string) =>
  ['cat', 'contact-field-history', contactId] as const;

/**
 * The field-level change history of one contact, newest first, "Load more" over the cursor. Reads the audit trail: one entry
 * per changed field. Needs `record.contacts.read` (the caller already has it to see the contact). The history is fetched when
 * the component using this hook mounts, which for the drawer is when it is opened.
 */
export function useFieldHistory(contactId: string) {
  return useCursorList(
    FIELD_HISTORY_KEY(contactId),
    `/contacts/${contactId}/field-history`,
    fieldHistoryEntrySchema,
    { limit: 50 },
    { retry: 0, retryDelay: 0 },
  );
}

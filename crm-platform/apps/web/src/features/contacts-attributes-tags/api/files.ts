'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contactFileResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCursorList } from '@/lib/api/use-cursor-list';

export const FILE_KEYS = {
  list: (contactId: string) => ['cat', 'files', contactId] as const,
  activities: (contactId: string) => ['cat', 'activities', contactId] as const,
};

/**
 * The files recorded against a contact. The API only stores a caller-supplied storage key (upload is not built yet),
 * so this is a read-only list.
 */
export function useContactFiles(contactId: string, enabled = true) {
  return useCursorList(
    FILE_KEYS.list(contactId),
    `/contacts/${contactId}/files`,
    contactFileResponseSchema,
    {},
    { enabled },
  );
}

/** Removes a file record from the contact (`record.contacts.update`). */
export function useRemoveContactFile(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<void> =>
      apiFetch(`/contacts/${contactId}/files/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: FILE_KEYS.list(contactId) }),
        qc.invalidateQueries({ queryKey: FILE_KEYS.activities(contactId) }),
      ]),
    onError: () => qc.invalidateQueries({ queryKey: FILE_KEYS.list(contactId) }),
  });
}

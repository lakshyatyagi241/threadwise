import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contactViewResponseSchema,
  pageResponseSchema,
  type ContactViewResponse,
  createContactViewSchema,
  type ViewAccessType,
  type ViewShareMode,
} from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

const KEY = ['contacts', 'views'] as const;

/** Every view the person can see (their own and the shared ones): a workspace has dozens, so one page is the whole list. */
export function useContactViews(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) =>
      (
        await apiFetch('/contact-views', {
          query: { limit: 200 },
          schema: pageResponseSchema(contactViewResponseSchema),
          signal,
        })
      ).data,
  });
}

/** Mutations that refresh the list when they finish. */
export function useViewMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: KEY });

  const create = useMutation({
    mutationFn: async (
      input: z.input<typeof createContactViewSchema> & { pin: boolean },
    ): Promise<ContactViewResponse> => {
      const { pin, ...body } = input;
      const view = await apiFetch('/contact-views', {
        method: 'POST',
        body,
        schema: contactViewResponseSchema,
      });
      // "Mark as Favorite": the view gets a tab of its own, as in Reference.
      if (pin) await apiFetch(`/contact-views/${view.id}/favorite`, { method: 'POST' });
      return { ...view, isFavorite: pin };
    },
    onSuccess: done,
  });

  const update = useMutation({
    mutationFn: (v: {
      view: ContactViewResponse;
      patch: {
        name?: string;
        filter?: Record<string, unknown>;
        isShared?: boolean;
        shareMode?: ViewShareMode;
        accessType?: ViewAccessType;
        userIds?: string[];
      };
    }) =>
      apiFetch(`/contact-views/${v.view.id}`, {
        method: 'PATCH',
        body: { ...v.patch, rowVersion: v.view.rowVersion },
        schema: contactViewResponseSchema,
      }),
    onSuccess: done,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/contact-views/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });

  const pin = useMutation({
    mutationFn: (v: { id: string; pinned: boolean }) =>
      apiFetch(`/contact-views/${v.id}/favorite`, { method: v.pinned ? 'POST' : 'DELETE' }),
    onSuccess: done,
  });

  return { create, update, remove, pin };
}

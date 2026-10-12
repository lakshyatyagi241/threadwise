import type { CreateContactActivityInput } from '@crm/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createContactActivity, listContactActivities } from './activity-api';
import { useActionKey } from './record-support';
import { contactKey } from './use-contacts';

/** Entries asked for at a time; the timeline shows a "Load more" button for the next page. */
export const ACTIVITY_PAGE_SIZE = 20;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const contactActivitiesKey = (contactId: string) =>
  ['contacts', 'activities', contactId] as const;

/** The contact's timeline, a page at a time, newest first. No request while `enabled` is false. */
export function useContactActivities(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: contactActivitiesKey(contactId),
    queryFn: ({ pageParam, signal }) =>
      listContactActivities(contactId, { limit: ACTIVITY_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && contactId !== '',
  });
}

/** Logs a manual entry. The timeline reloads, and so does the contact (its "last activity" moves). */
export function useCreateActivity(contactId: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: CreateContactActivityInput) =>
      createContactActivity(contactId, body, key.current()),
    onError: key.failed,
    onSuccess: () => {
      key.renew();
      void queryClient.invalidateQueries({ queryKey: contactActivitiesKey(contactId) });
      void queryClient.invalidateQueries({ queryKey: contactKey(contactId) });
    },
  });
}

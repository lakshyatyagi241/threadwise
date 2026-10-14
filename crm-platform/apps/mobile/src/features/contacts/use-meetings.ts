import { useInfiniteQuery } from '@tanstack/react-query';
import { listContactMeetings } from './meetings-api';

/** Meetings asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const MEETINGS_PAGE_SIZE = 20;

export const contactMeetingsKey = (contactId: string) =>
  ['contacts', 'meetings', contactId] as const;

/** The contact's logged meetings, a page at a time, newest first. No request while `enabled` is false. */
export function useContactMeetings(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: contactMeetingsKey(contactId),
    queryFn: ({ pageParam, signal }) =>
      listContactMeetings(contactId, { limit: MEETINGS_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && contactId !== '',
  });
}

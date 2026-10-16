import { ERROR_CODES, type NotificationListResponse } from '@crm/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/api';
import { unreadKey } from '@/lib/notifications/unread';
import { useActionKeys } from '@/lib/query/use-action-keys';
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';

/** Rows asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const PAGE_SIZE = 30;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const notificationListsKey = ['notifications', 'list'] as const;
export const notificationListKey = (unreadOnly: boolean) =>
  [...notificationListsKey, { unreadOnly }] as const;

type Pages = InfiniteData<NotificationListResponse, string | undefined>;

/** The feed, a page at a time. `unreadOnly` narrows it to what has not been read. */
export function useNotificationList(unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: notificationListKey(unreadOnly),
    queryFn: ({ pageParam, signal }) =>
      listNotifications({ limit: PAGE_SIZE, cursor: pageParam, unreadOnly }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

/** Rewrites the rows already on screen (every cached list), so a change shows at once and the next refetch only confirms it. */
function patchRows(
  queryClient: QueryClient,
  change: (rows: NotificationListResponse['data']) => NotificationListResponse['data'],
) {
  queryClient.setQueriesData<Pages>({ queryKey: notificationListsKey }, (old) =>
    old ? { ...old, pages: old.pages.map((page) => ({ ...page, data: change(page.data) })) } : old,
  );
}

const refreshUnread = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: unreadKey });

/** Marks one notification read: the row loses its unread mark and the bell's count is asked again. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (id: string) => markNotificationRead(id, keys.keyFor(`read:${id}`)),
    onError: (error, id) => keys.failed(`read:${id}`, error),
    onSuccess: (row, id) => {
      keys.done(`read:${id}`);
      patchRows(queryClient, (rows) => rows.map((r) => (r.id === row.id ? row : r)));
      void refreshUnread(queryClient);
    },
  });
}

/** Marks everything read. The lists are fetched again (the unread view becomes empty). */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: () => markAllNotificationsRead(keys.keyFor('read-all')),
    onError: (error) => keys.failed('read-all', error),
    onSuccess: () => {
      keys.done('read-all');
      void queryClient.invalidateQueries({ queryKey: notificationListsKey });
      void refreshUnread(queryClient);
    },
  });
}

/** Dismisses one notification. A row that is already gone (404) counts as dismissed. */
export function useDismiss() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  const forget = (id: string) => {
    patchRows(queryClient, (rows) => rows.filter((r) => r.id !== id));
    void refreshUnread(queryClient);
  };
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (id: string) => dismissNotification(id, keys.keyFor(`dismiss:${id}`)),
    onError: (error, id) => {
      keys.failed(`dismiss:${id}`, error);
      if (isApiError(error) && error.code === ERROR_CODES.NOT_FOUND) forget(id);
    },
    onSuccess: (_, id) => {
      keys.done(`dismiss:${id}`);
      forget(id);
    },
  });
}

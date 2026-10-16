import {
  deleteNotificationsResponseSchema,
  markAllReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

export interface NotificationListParams {
  limit: number;
  cursor?: string;
  /** Only the unread ones. */
  unreadOnly: boolean;
}

/** One page of the person's own notifications, newest first. `meta.unread` is the true unread total, not the page's. */
export const listNotifications = (params: NotificationListParams, signal?: AbortSignal) =>
  apiFetch('/v2/notifications', {
    query: {
      limit: params.limit,
      cursor: params.cursor,
      unreadOnly: params.unreadOnly ? true : undefined,
    },
    schema: notificationListResponseSchema,
    signal,
  });

/** Marks one notification read. Doing it again changes nothing; someone else's, or an unknown id, is 404. */
export const markNotificationRead = (id: string, idempotencyKey?: string) =>
  apiFetch(`/v2/notifications/${id}/read`, {
    method: 'POST',
    schema: notificationResponseSchema,
    idempotencyKey,
  });

/** Marks every notification of the person read. Answers with how many changed. */
export const markAllNotificationsRead = (idempotencyKey?: string) =>
  apiFetch('/v2/notifications/read-all', {
    method: 'POST',
    schema: markAllReadResponseSchema,
    idempotencyKey,
  });

/** Removes one notification for good (for the person only). An unknown id is 404. */
export const dismissNotification = (id: string, idempotencyKey?: string) =>
  apiFetch(`/v2/notifications/${id}`, {
    method: 'DELETE',
    schema: deleteNotificationsResponseSchema,
    idempotencyKey,
  });

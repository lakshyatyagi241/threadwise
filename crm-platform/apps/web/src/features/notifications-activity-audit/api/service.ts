import {
  markAllReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  unreadCountResponseSchema,
  type NotificationListResponse,
  type NotificationResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** Every notifications call, one function each, parsed with the shared contracts. */
export const notificationsApi = {
  list(limit: number, signal?: AbortSignal): Promise<NotificationListResponse> {
    return apiFetch('/notifications', {
      query: { limit },
      schema: notificationListResponseSchema,
      signal,
    });
  },
  async unread(signal?: AbortSignal): Promise<number> {
    const res = await apiFetch('/notifications/unread-count', {
      schema: unreadCountResponseSchema,
      signal,
    });
    return res.unread;
  },
  markRead(id: string): Promise<NotificationResponse> {
    return apiFetch(`/notifications/${id}/read`, {
      method: 'POST',
      body: {},
      schema: notificationResponseSchema,
    });
  },
  async markAllRead(): Promise<number> {
    const res = await apiFetch('/notifications/read-all', {
      method: 'POST',
      body: {},
      schema: markAllReadResponseSchema,
    });
    return res.updated;
  },
};

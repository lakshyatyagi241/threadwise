import {
  markAllReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  readSubjectResponseSchema,
  unreadCountResponseSchema,
  type NotificationListResponse,
  type NotificationResponse,
  type ReadSubjectResponse,
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
  /** Marks the caller's unread rows about one conversation read (the client's guard when the thread is already open). */
  readSubject(id: string): Promise<ReadSubjectResponse> {
    return apiFetch('/notifications/read-subject', {
      method: 'POST',
      body: { kind: 'conversation', id },
      schema: readSubjectResponseSchema,
    });
  },
};

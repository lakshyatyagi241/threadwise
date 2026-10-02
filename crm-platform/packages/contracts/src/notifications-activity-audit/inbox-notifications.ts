import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';

/**
 * The in-app notification feed behind the header bell (WD-NOTIF-006, 012, 015, 017): one row per person notified,
 * written by outbox consumers (task assigned, due, completed) and read by the person it is for.
 *
 * `type` says what happened and `data` carries the pieces a client needs to word it in the viewer's language
 * (`taskTitle`, `actorName`, ...); `title` and `body` are the server's English wording, the fallback for a type
 * the client does not know yet.
 */
export const NOTIFICATION_TYPES = ['task_assigned', 'task_due', 'task_completed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationResponseSchema = z.object({
  id: uuidSchema,
  /** A NotificationType today; other values may appear as more domains start notifying. */
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** App path to open (`/tasks`), never an absolute URL. */
  link: z.string().nullable(),
  data: z.record(z.unknown()).nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: cursorSchema.optional(),
  unreadOnly: queryBoolean().default(false),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** `meta.unread` is the true unread total for the caller (not just this page), so the badge needs no second call. */
export const notificationListResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  page: pageInfoSchema,
  meta: z.object({ unread: z.number().int().min(0) }),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadCountResponseSchema = z.object({ unread: z.number().int().min(0) });
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

export const markAllReadResponseSchema = z.object({ updated: z.number().int().min(0) });
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

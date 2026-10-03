import { z } from 'zod';

/**
 * The platform notification feed behind the console bell and `/admin/notifications` (TW-ASHELL-006). Reference derives it live
 * from what happened across the whole platform, so there is no store of notifications: five event kinds, newest first,
 * and "unread" is whatever is newer than the operator's own last-seen marker.
 */
export const OPERATOR_NOTIFICATION_TYPES = [
  'signup',
  'payment',
  'ticket',
  'contact',
  'workspace',
] as const;
export const operatorNotificationTypeSchema = z.enum(OPERATOR_NOTIFICATION_TYPES);
export type OperatorNotificationType = z.infer<typeof operatorNotificationTypeSchema>;

export const OPERATOR_NOTIFICATION_SEVERITIES = ['info', 'success', 'warning'] as const;

export const operatorNotificationSchema = z.object({
  /** `<kind>-<uuid>`: stable per source row. */
  id: z.string(),
  type: operatorNotificationTypeSchema,
  /** Which headline the screen words (the API names the event, the web translates it). */
  titleKey: z.enum([
    'signup',
    'paymentReceived',
    'newOrder',
    'newTicket',
    'newContactMessage',
    'newWorkspace',
  ]),
  /** The order number for a payment or order headline ("#ORD-1042"), else null. */
  ref: z.string().nullable(),
  message: z.string().nullable(),
  severity: z.enum(OPERATOR_NOTIFICATION_SEVERITIES),
  unread: z.boolean(),
  /** Console path of the screen that handles it. */
  actionUrl: z.string(),
  /** ISO-8601. */
  at: z.string(),
});
export type OperatorNotification = z.infer<typeof operatorNotificationSchema>;

/** The bell: the 15 newest, plus the real unread count. */
export const operatorNotificationsRecentSchema = z.object({
  items: z.array(operatorNotificationSchema),
  unread: z.number().int().nonnegative(),
});
export type OperatorNotificationsRecent = z.infer<typeof operatorNotificationsRecentSchema>;

export const operatorNotificationsQuerySchema = z.object({
  type: z.enum(['all', ...OPERATOR_NOTIFICATION_TYPES]).default('all'),
  q: z.string().trim().max(120).optional(),
});
export type OperatorNotificationsQuery = z.infer<typeof operatorNotificationsQuerySchema>;

/** The full page: up to 120 events and the 30-day counts for the KPI strip. */
export const operatorNotificationsPageSchema = z.object({
  items: z.array(operatorNotificationSchema),
  stats: z.object({
    total: z.number().int().nonnegative(),
    signup: z.number().int().nonnegative(),
    payment: z.number().int().nonnegative(),
    ticket: z.number().int().nonnegative(),
    contact: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
  }),
});
export type OperatorNotificationsPage = z.infer<typeof operatorNotificationsPageSchema>;

export const operatorNotificationsSeenSchema = z.object({ unread: z.literal(0) });
export type OperatorNotificationsSeen = z.infer<typeof operatorNotificationsSeenSchema>;

/** The header badge text: 99+ above ninety-nine, nothing at zero. */
export function bellBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

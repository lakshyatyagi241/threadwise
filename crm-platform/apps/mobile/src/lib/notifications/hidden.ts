import {
  NOTIFICATION_CATALOG,
  type NotificationGroup,
  type NotificationPrefType,
  type NotificationResponse,
} from '@crm/contracts';

/**
 * The kinds of notification the phone app does not show. The server still creates them (the web shows all of them), so the app
 * leaves them out of its list, its unread count and its live alert. A kind this build does not know is shown: it may be about a chat.
 *
 * Typed over `NotificationPrefType`, so a misspelt kind fails the type check. Whole sections are hidden by group, so a kind added
 * to one of them later is hidden too.
 */

/** Single kinds, one by one. */
const HIDDEN_TYPES: ReadonlySet<NotificationPrefType> = new Set<NotificationPrefType>([
  'mention',
  'email_bounced',
  'member_leave_started',
  'assignment_blocked_by_leave',
  'appointment_calendar_drift',
  'appointment_cancelled_by_customer',
  'appointment_reminder_test',
  'new_lead',
  'form_submission',
  'form_needs_review',
  'form_payment',
  'form_payment_duplicate',
  'sales_doc_decided',
  'wallet_low_balance',
  'wallet_credited',
  'test',
]);

/** Whole sections: billing and subscriptions (paid-app renewals too), WhatsApp numbers, broadcasts and campaigns, team chat, groups. */
const HIDDEN_GROUPS: ReadonlySet<NotificationGroup> = new Set<NotificationGroup>([
  'billing',
  'devices',
  'broadcasts',
  'team_chat',
  'whatsapp_groups',
]);

const isKnown = (type: string): type is NotificationPrefType =>
  Object.hasOwn(NOTIFICATION_CATALOG, type);

/** True for a kind the app leaves out. */
export function isHiddenType(type: string): boolean {
  if (!isKnown(type)) return false;
  return HIDDEN_TYPES.has(type) || HIDDEN_GROUPS.has(NOTIFICATION_CATALOG[type].group);
}

/** The rows the app shows: the list without the hidden kinds, in the same order. */
export const visibleRows = (rows: readonly NotificationResponse[]): NotificationResponse[] =>
  rows.filter((row) => !isHiddenType(row.type));

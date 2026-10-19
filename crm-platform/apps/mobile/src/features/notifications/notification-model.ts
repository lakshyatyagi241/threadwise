import {
  NOTIFICATION_CATALOG,
  type NotificationGroup,
  type NotificationPrefType,
  type NotificationResponse,
} from '@crm/contracts';
import type { Href } from 'expo-router';
import type { IconName } from '@/components/ui/icon';

/**
 * What the app knows about each kind of notification, in one table: its icon and tone, and the words that describe it come from
 * `notification-text.ts`. Ported from the web bell (`notifications-activity-audit/lib/catalogue.ts`). A type this build does not
 * list (a domain that started notifying later) gets `FALLBACK_LOOK`: a plain bell row in the server's English words.
 */

/** `danger` for things that went wrong (a device dropped, a send failed), `success` for finished work, `info` otherwise. */
export type NotificationTone = 'info' | 'success' | 'danger';

interface Look {
  icon: IconName;
  tone: NotificationTone;
}

const CHAT: IconName = 'chatbubble-ellipses-outline';
const WAITING: IconName = 'time-outline';
const ASSIGN: IconName = 'person-add-outline';
const MENTION: IconName = 'at-outline';
const TEAM_CHAT: IconName = 'people-outline';
const GROUP: IconName = 'people-circle-outline';
const DEVICE_ON: IconName = 'phone-portrait-outline';
const DEVICE_OFF: IconName = 'cloud-offline-outline';
const BROADCAST: IconName = 'megaphone-outline';
const CAMPAIGN: IconName = 'rocket-outline';
const SCHEDULE: IconName = 'calendar-outline';
const TASK: IconName = 'checkbox-outline';
const LEAD: IconName = 'sparkles-outline';
const FORM: IconName = 'document-text-outline';
const DOCUMENT: IconName = 'document-outline';
const WALLET: IconName = 'wallet-outline';
const GENERIC: IconName = 'notifications-outline';

const look = (icon: IconName, tone: NotificationTone): Look => ({ icon, tone });

/** Being a `Record` over every preference type, a type added to the contracts without an entry here fails the type check. */
const LOOK: Record<NotificationPrefType, Look> = {
  new_chat: look(CHAT, 'info'),
  new_message: look(CHAT, 'info'),
  chat_waiting: look(WAITING, 'info'),
  conversation_assigned: look(ASSIGN, 'info'),
  snooze_wake: look(WAITING, 'info'),
  mention: look(MENTION, 'info'),
  task_assigned: look(TASK, 'info'),
  task_due: look(TASK, 'info'),
  task_completed: look(TASK, 'success'),
  new_lead: look(LEAD, 'info'),
  form_submission: look(FORM, 'info'),
  form_needs_review: look(FORM, 'info'),
  form_payment: look(FORM, 'success'),
  form_payment_duplicate: look(FORM, 'danger'),
  sales_doc_decided: look(DOCUMENT, 'info'),
  wallet_low_balance: look(WALLET, 'danger'),
  wallet_credited: look(WALLET, 'success'),
  billing_payment_failed: look(WALLET, 'danger'),
  billing_subscription_canceled: look(WALLET, 'info'),
  marketplace_renewal_due: look(WALLET, 'info'),
  marketplace_payment_failed: look(WALLET, 'danger'),
  marketplace_subscription_ended: look(WALLET, 'danger'),
  device_connected: look(DEVICE_ON, 'success'),
  device_disconnected: look(DEVICE_OFF, 'danger'),
  device_logged_out: look(DEVICE_OFF, 'danger'),
  broadcast_completed: look(BROADCAST, 'success'),
  broadcast_failed: look(BROADCAST, 'danger'),
  campaign_completed: look(CAMPAIGN, 'success'),
  campaign_failed: look(CAMPAIGN, 'danger'),
  scheduled_completed: look(SCHEDULE, 'success'),
  scheduled_failed: look(SCHEDULE, 'danger'),
  teamchat_mention: look(MENTION, 'info'),
  teamchat_message: look(TEAM_CHAT, 'info'),
  email_bounced: look(CHAT, 'danger'),
  sla_breached: look(WAITING, 'danger'),
  member_leave_started: look(ASSIGN, 'info'),
  assignment_blocked_by_leave: look(WAITING, 'danger'),
  appointment_calendar_drift: look(WAITING, 'danger'),
  waba_group_join_request: look(GROUP, 'info'),
  waba_group_suspended: look(GROUP, 'danger'),
  waba_group_suspension_cleared: look(GROUP, 'success'),
  device_group_join_request: look(GROUP, 'info'),
  device_group_removed: look(GROUP, 'danger'),
  test: look(GENERIC, 'info'),
};

const FALLBACK_LOOK: Look = look(GENERIC, 'info');

/** True for a type this build can word in the person's language. */
export const isKnownType = (type: string): type is NotificationPrefType =>
  Object.hasOwn(LOOK, type);

export const lookOf = (type: string): Look => (isKnownType(type) ? LOOK[type] : FALLBACK_LOOK);

/** The wording group of a known type (conversations, devices, ...), taken from the shared catalogue the server also uses. */
export const groupOf = (type: NotificationPrefType): NotificationGroup =>
  NOTIFICATION_CATALOG[type].group;

// --- where a notification opens ----------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value : null;

const CHAT_TYPES: readonly string[] = [
  'new_chat',
  'new_message',
  'chat_waiting',
  'conversation_assigned',
  'snooze_wake',
  'mention',
  'email_bounced',
  'sla_breached',
  'assignment_blocked_by_leave',
];
const TASK_TYPES: readonly string[] = ['task_assigned', 'task_due', 'task_completed'];

type TargetSource = Pick<NotificationResponse, 'type' | 'data'> & {
  subject?: NotificationResponse['subject'];
};

/**
 * The screen a row opens: a chat opens its thread, a task its page, a lead its contact. The server's own `link` is a web path
 * (`/inbox?c=...`, `/tasks?task=...`), so the app builds its route from the row's `data` and `subject` instead. A type with no screen
 * in the app yet (devices, broadcasts, team chat, groups, wallet, forms) returns null: the row is still read and marked read, and
 * the owner is told which ones are missing (backlog row `blocked`).
 */
export function notificationTarget(n: TargetSource): Href | null {
  const data = n.data ?? {};
  if (CHAT_TYPES.includes(n.type)) {
    const id =
      idOf(data.conversationId) ?? (n.subject?.kind === 'conversation' ? idOf(n.subject.id) : null);
    return id ? { pathname: '/conversation/[id]', params: { id } } : null;
  }
  if (TASK_TYPES.includes(n.type)) {
    const id = idOf(data.taskId);
    return id ? { pathname: '/task/[id]', params: { id } } : null;
  }
  if (n.type === 'new_lead') {
    const id = idOf(data.contactId);
    return id ? { pathname: '/contact/[id]', params: { id } } : null;
  }
  return null;
}

// --- day sections -----------------------------------------------------------------------------------------------------------

export type DaySection = 'today' | 'yesterday' | 'thisWeek' | 'older';
const DAY_SECTIONS: readonly DaySection[] = ['today', 'yesterday', 'thisWeek', 'older'];
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Which section a moment falls in, by the person's calendar days: today, yesterday, the last week, older. */
export function sectionOf(at: Date, now: Date): DaySection {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < WEEK_DAYS ? 'thisWeek' : 'older';
}

export interface DayGroup {
  section: DaySection;
  data: NotificationResponse[];
}

/** The rows grouped in section order (empty sections left out), each keeping the server's newest-first order. */
export function groupByDay(rows: readonly NotificationResponse[], now: Date): DayGroup[] {
  const by = new Map<DaySection, NotificationResponse[]>();
  for (const row of rows) {
    const section = sectionOf(new Date(row.createdAt), now);
    const list = by.get(section) ?? [];
    list.push(row);
    by.set(section, list);
  }
  return DAY_SECTIONS.filter((s) => by.has(s)).map((section) => ({
    section,
    data: by.get(section) ?? [],
  }));
}

/** The time shown on a row: the clock for the last week (the section already says which day), the date for older ones. */
export function formatRowTime(iso: string, section: DaySection, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const options: Intl.DateTimeFormatOptions =
    section === 'older'
      ? { day: 'numeric', month: 'short' }
      : section === 'thisWeek'
        ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
        : { hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(at);
}

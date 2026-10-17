import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationPrefType,
  type NotificationResponse,
} from '@crm/contracts';

/**
 * What the app knows about each kind of notification, in one table: which group it belongs to (the preferences screen's sections),
 * its icon and tone, whether it may pop up a toast or play the ping, which of the workspace owner's toggles governs it, and where it
 * opens. Nothing here needs React, so the bell, the toast, the announcements and the preferences screen all read the same answers
 * and the rules are tested without a browser.
 *
 * A type this build does not list (a domain that started notifying after this build) gets `FALLBACK_META`: a plain bell row in the
 * server's English words that opens the server's own link, with no toast and no sound.
 */

export { NOTIFICATION_GROUPS, type NotificationGroup };

export const NOTIFICATION_ICONS = [
  'chat',
  'waiting',
  'assign',
  'mention',
  'team_chat',
  'group',
  'device_on',
  'device_off',
  'broadcast',
  'campaign',
  'schedule',
  'task',
  'lead',
  'form',
  'document',
  'wallet',
  'generic',
] as const;
export type NotificationIcon = (typeof NOTIFICATION_ICONS)[number];

/** `danger` for things that went wrong (a device dropped, a send failed), `success` for finished work, `info` otherwise. */
export type NotificationTone = 'info' | 'success' | 'danger';

export interface TypeMeta {
  group: NotificationGroup;
  icon: NotificationIcon;
  tone: NotificationTone;
  /** May raise a pop-up when the tab is in front (the catalogue default; the person's own choice and the event's `toast` flag refine it). */
  toast: boolean;
  /** May play the ping (same refinement). */
  sound: boolean;
  /** A browser (Web Push) notification is on by default (chats, assignments, mentions). */
  push: boolean;
  /** The kind of record the row is about, used to build a link when the server sent none. */
  subject?:
    | 'conversation'
    | 'device'
    | 'broadcast'
    | 'campaign'
    | 'scheduled_message'
    | 'team_chat_channel'
    | 'waba_group'
    | 'device_group';
}

type Look = Pick<TypeMeta, 'icon' | 'tone' | 'subject'>;
const look = (
  icon: NotificationIcon,
  tone: NotificationTone,
  subject?: TypeMeta['subject'],
): Look => ({
  icon,
  tone,
  subject,
});

/**
 * How each type looks and where it opens. The group and the default toast and ping come from the shared catalogue in
 * `@crm/contracts` (the same table the server resolves preferences with), so the two cannot drift; being a `Record` over every
 * preference type, a type added to the contracts without an entry here fails the type check.
 */
const LOOK: Record<NotificationPrefType, Look> = {
  new_chat: look('chat', 'info', 'conversation'),
  new_message: look('chat', 'info', 'conversation'),
  chat_waiting: look('waiting', 'info', 'conversation'),
  conversation_assigned: look('assign', 'info', 'conversation'),
  snooze_wake: look('waiting', 'info', 'conversation'),
  mention: look('mention', 'info', 'conversation'),
  task_assigned: look('task', 'info'),
  task_due: look('task', 'info'),
  task_completed: look('task', 'success'),
  new_lead: look('lead', 'info'),
  form_submission: look('form', 'info'),
  form_needs_review: look('form', 'info'),
  form_payment: look('form', 'success'),
  form_payment_duplicate: look('form', 'danger'),
  sales_doc_decided: look('document', 'info'),
  wallet_low_balance: look('wallet', 'danger'),
  wallet_credited: look('wallet', 'success'),
  billing_payment_failed: look('wallet', 'danger'),
  billing_subscription_canceled: look('wallet', 'info'),
  device_connected: look('device_on', 'success', 'device'),
  device_disconnected: look('device_off', 'danger', 'device'),
  device_logged_out: look('device_off', 'danger', 'device'),
  broadcast_completed: look('broadcast', 'success', 'broadcast'),
  broadcast_failed: look('broadcast', 'danger', 'broadcast'),
  campaign_completed: look('campaign', 'success', 'campaign'),
  campaign_failed: look('campaign', 'danger', 'campaign'),
  scheduled_completed: look('schedule', 'success', 'scheduled_message'),
  scheduled_failed: look('schedule', 'danger', 'scheduled_message'),
  teamchat_mention: look('mention', 'info', 'team_chat_channel'),
  teamchat_message: look('team_chat', 'info', 'team_chat_channel'),
  email_bounced: look('chat', 'danger', 'conversation'),
  sla_breached: look('waiting', 'danger', 'conversation'),
  member_leave_started: look('assign', 'info'),
  assignment_blocked_by_leave: look('waiting', 'danger', 'conversation'),
  appointment_calendar_drift: look('waiting', 'danger'),
  waba_group_join_request: look('group', 'info', 'waba_group'),
  waba_group_suspended: look('group', 'danger', 'waba_group'),
  waba_group_suspension_cleared: look('group', 'success', 'waba_group'),
  device_group_join_request: look('group', 'info', 'device_group'),
  device_group_removed: look('group', 'danger', 'device_group'),
  test: look('generic', 'info'),
};

export const TYPE_CATALOGUE: Readonly<Record<string, TypeMeta>> = Object.fromEntries(
  (Object.keys(LOOK) as NotificationPrefType[]).map((type) => [
    type,
    {
      ...LOOK[type],
      group: NOTIFICATION_CATALOG[type].group,
      toast: NOTIFICATION_CATALOG[type].toast,
      sound: NOTIFICATION_CATALOG[type].sound,
      push: NOTIFICATION_CATALOG[type].push,
    } satisfies TypeMeta,
  ]),
);

export const FALLBACK_META: TypeMeta = {
  group: 'tasks',
  icon: 'generic',
  tone: 'info',
  toast: false,
  sound: false,
  push: false,
};

/** True for a type this build can word in the viewer's language. */
export function isKnownType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(TYPE_CATALOGUE, type);
}

export function typeMeta(type: string): TypeMeta {
  return isKnownType(type) ? TYPE_CATALOGUE[type]! : FALLBACK_META;
}

/** The types of a group, in catalogue order. */
export function typesOfGroup(group: NotificationGroup): string[] {
  return Object.keys(TYPE_CATALOGUE).filter((t) => TYPE_CATALOGUE[t]!.group === group);
}

/** How long a toast of this tone stays: a problem stays longer so it can be read (the UI package's rule: 5 s, 9 s for danger). */
export function toastLifetimeMs(tone: NotificationTone): number {
  return tone === 'danger' ? 9_000 : 5_000;
}

// --- where a notification opens ------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value : null;

/** An app path the server named: anything else (an absolute URL, a protocol-relative one) is ignored. */
export function safeLink(link: string | null | undefined): string | null {
  return typeof link === 'string' && /^\/(?!\/)/.test(link) ? link : null;
}

type LinkSource = Pick<NotificationResponse, 'type' | 'link' | 'data'> & {
  subject?: NotificationResponse['subject'];
};

/**
 * Where a row opens. The server's own link wins (it knows the route); when it sent none, the link is built from the row's `data` and
 * `subject`: a device opens `/devices/<id>`, a broadcast or a scheduled send its detail, a campaign its page, a conversation the Inbox
 * with the thread open, a team chat channel or direct message the Team chat with that channel selected. A row with nothing to open
 * returns null, so it is a plain button.
 */
export function notificationHref(n: LinkSource): string | null {
  const given = safeLink(n.link);
  if (given) return given;
  const m = typeMeta(n.type);
  const d = n.data ?? {};
  const fromSubject = (kind: string) => (n.subject?.kind === kind ? id(n.subject.id) : null);
  // A send outcome names what it is about in `data.kind` / `data.id`.
  const outcomeId = (kind: string) => (d.kind === kind ? id(d.id) : null);
  switch (m.subject) {
    case 'conversation': {
      const c = id(d.conversationId) ?? fromSubject('conversation');
      return c ? `/inbox?c=${c}` : null;
    }
    case 'device': {
      const dev = id(d.deviceId) ?? fromSubject('device');
      return dev ? `/devices/${dev}` : null;
    }
    case 'broadcast': {
      const b = outcomeId('broadcast') ?? fromSubject('broadcast');
      return b ? `/broadcasts/${b}` : null;
    }
    case 'campaign': {
      const c = outcomeId('campaign') ?? fromSubject('campaign');
      return c ? `/campaigns/${c}` : null;
    }
    case 'scheduled_message': {
      const sc = outcomeId('scheduled_message') ?? fromSubject('scheduled_message');
      return sc ? `/scheduled/${sc}` : null;
    }
    case 'team_chat_channel': {
      const ch = id(d.channelId) ?? fromSubject('team_chat_channel');
      return ch ? `/team-chat?c=${ch}` : null;
    }
    case 'waba_group': {
      const conn = id(d.connectionId);
      return conn ? `/waba-groups?account=${conn}` : '/waba-groups';
    }
    case 'device_group': {
      // The Groups tab of the personal numbers: `?device=` selects the number the group belongs to.
      const dev = id(d.deviceId);
      return dev ? `/devices/groups?device=${dev}` : '/devices/groups';
    }
    default:
      return null;
  }
}

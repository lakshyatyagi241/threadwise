import type { NotificationResponse } from '@crm/contracts';
import { isKnownType, safeLink, typeMeta } from './catalogue';

export { safeLink };

/** The slice of next-intl's translator these helpers need (so they can be tested without React). */
export interface Translator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * What a notification says, in the viewer's language. Types this build knows are worded from `data` through the
 * messages; any other type (a domain that started notifying after this build) shows the server's English wording.
 */
export function notificationText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'title' | 'body' | 'data' | 'count'>,
): { title: string; body: string | null } {
  if (
    !isKnownType(n.type) ||
    !(t.has(`types.${n.type}.title`) || t.has(`types.${n.type}.titleNoName`))
  )
    return { title: n.title, body: n.body };
  if (n.type === 'new_lead') return leadText(t, n.data);
  if (isChatType(n.type)) return conversationText(t, n);
  const group = typeMeta(n.type).group;
  if (group === 'devices') return deviceText(t, n);
  if (group === 'broadcasts') return sendingText(t, n);
  if (group === 'team_chat') return teamChatText(t, n);
  const task = text(n.data?.taskTitle);
  const actor = text(n.data?.actorName);
  const body = actor
    ? t.has(`types.${n.type}.body`)
      ? t(`types.${n.type}.body`, { task, actor })
      : task
    : t.has(`types.${n.type}.bodyNoActor`)
      ? t(`types.${n.type}.bodyNoActor`, { task })
      : task;
  return { title: t(`types.${n.type}.title`), body: body || null };
}

/** The notification types about a conversation: they toast, ping and open the thread. */
export const CHAT_NOTIFICATION_TYPES = [
  'new_chat',
  'new_message',
  'chat_waiting',
  'conversation_assigned',
  'mention',
] as const;
export type ChatNotificationType = (typeof CHAT_NOTIFICATION_TYPES)[number];
export function isChatType(type: string): type is ChatNotificationType {
  return (CHAT_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** The longest preview a bell row, toast or announcement shows (decision D4). */
export const PREVIEW_MAX = 80;

/** A preview cut to `max` characters (code points, so an emoji is never split) on one line, with an ellipsis when cut. */
export function clipPreview(value: unknown, max = PREVIEW_MAX): string {
  const flat = text(value).replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= max
    ? flat
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * The chat types worded from `data.contactName`, `data.preview` and the row's `count`. Every field may be missing (a row from an
 * older server, a contact with no name), so each has a wording of its own that needs no name.
 */
function conversationText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'data' | 'count'>,
): { title: string; body: string | null } {
  const d = n.data ?? {};
  const name = text(d.contactName).trim();
  const preview = clipPreview(d.preview);
  const rawCount = n.count ?? d.count;
  const count = typeof rawCount === 'number' && rawCount >= 1 ? Math.floor(rawCount) : 1;
  const base = `types.${n.type}`;
  switch (n.type) {
    case 'new_message':
      return {
        title: name ? t(`${base}.title`, { name, count }) : t(`${base}.titleNoName`, { count }),
        body: preview || null,
      };
    case 'conversation_assigned': {
      const team = d.teamAssigned === true;
      const key = `${base}.${team ? 'titleTeam' : 'title'}${name ? '' : 'NoName'}`;
      const actor = text(d.assignedByName).trim();
      return {
        title: name ? t(key, { name }) : t(key),
        body: actor ? t(`${base}.body`, { actor }) : preview || null,
      };
    }
    case 'mention': {
      const actor = text(d.authorName).trim();
      return {
        title: actor ? t(`${base}.title`, { actor }) : t(`${base}.titleNoName`),
        body: name && preview ? t(`${base}.body`, { name, preview }) : preview || name || null,
      };
    }
    default:
      return {
        title: name ? t(`${base}.title`, { name }) : t(`${base}.titleNoName`),
        body: preview || null,
      };
  }
}

const firstText = (d: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = text(d[k]).trim();
    if (v) return v;
  }
  return '';
};
const wholeCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** A personal WhatsApp number: connected, dropped, or logged out from the phone. Named by its label (else its number). */
function deviceText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'data'>,
): { title: string; body: string | null } {
  const d = n.data ?? {};
  const name = firstText(d, 'deviceName', 'maskedNumber');
  const base = `types.${n.type}`;
  const hint = t.has(`${base}.body`) ? t(`${base}.body`) : null;
  return {
    title: name ? t(`${base}.title`, { name }) : t(`${base}.titleNoName`),
    body: hint,
  };
}

/**
 * A broadcast, a campaign or a scheduled send that finished or failed. A finished one says how many went out and how many did not
 * (each with its own plural); a failed one shows the reason when the server named one.
 */
function sendingText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'data'>,
): { title: string; body: string | null } {
  const d = n.data ?? {};
  const name = firstText(d, 'name');
  const base = `types.${n.type}`;
  const sent = wholeCount(d.sent ?? d.delivered);
  const failed = wholeCount(d.failed);
  let body: string | null = null;
  if (n.type.endsWith('_failed')) {
    const reason = clipPreview(firstText(d, 'reason'));
    body = reason
      ? t(`${base}.body`, { reason })
      : t.has(`${base}.bodyNoReason`)
        ? t(`${base}.bodyNoReason`)
        : null;
  } else if (sent !== null && failed !== null && failed > 0) {
    body = t(`${base}.bodySentFailed`, { sent, failed });
  } else if (sent !== null) {
    body = t(`${base}.bodySent`, { sent });
  }
  return { title: name ? t(`${base}.title`, { name }) : t(`${base}.titleNoName`), body };
}

/** Team chat: a colleague mentioned me in a channel, or wrote to me directly (collapsed rows carry a count). */
function teamChatText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'data' | 'count'>,
): { title: string; body: string | null } {
  const d = n.data ?? {};
  const author = firstText(d, 'authorName');
  const channel = firstText(d, 'channelName');
  const preview = clipPreview(d.preview);
  const rawCount = n.count ?? d.count;
  const count = typeof rawCount === 'number' && rawCount >= 1 ? Math.floor(rawCount) : 1;
  const base = `types.${n.type}`;
  let title: string;
  if (n.type === 'teamchat_mention') {
    title = author
      ? channel
        ? t(`${base}.title`, { author, channel })
        : t(`${base}.titleNoChannel`, { author })
      : t(`${base}.titleNoName`);
  } else {
    title = author ? t(`${base}.title`, { author, count }) : t(`${base}.titleNoName`, { count });
  }
  return { title, body: preview || null };
}

/** A lead from a lead source: the contact's name and the platform it came from (`data.contactName`, `data.platform`); `returning` for a repeat. */
function leadText(
  t: Translator,
  data: NotificationResponse['data'],
): { title: string; body: string | null } {
  const name = text(data?.contactName);
  const platform = text(data?.platform);
  const returning = data?.returning === true;
  const body = !name
    ? null
    : platform
      ? t(returning ? 'types.new_lead.bodyReturning' : 'types.new_lead.body', { name, platform })
      : t('types.new_lead.bodyNoActor', { name });
  return { title: t(returning ? 'types.new_lead.titleReturning' : 'types.new_lead.title'), body };
}

/** "99+" past 99, nothing at 0. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

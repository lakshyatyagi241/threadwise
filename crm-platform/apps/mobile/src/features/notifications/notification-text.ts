import type { NotificationResponse } from '@crm/contracts';
import type { i18n as I18n } from 'i18next';
import { groupOf, isKnownType } from './notification-model';

/**
 * What a notification says, in the person's language. Ported from the web bell (`notifications-activity-audit/lib/copy.ts`).
 * A type this build knows is worded from the row's `data` through the message files; any other type (a domain that started
 * notifying after this build) shows the server's English `title` and `body`.
 *
 * The keys are built from the type, so the translator is passed in untyped: `has` says whether a key exists in the active language.
 */
export interface Translator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string, values?: Record<string, string | number>): boolean;
}

/** A translator over the app's language, for keys that are built from the notification's type (so they are plain strings). */
export function translatorFor(instance: I18n): Translator {
  const lookup = (key: string, values?: Record<string, string | number>): string =>
    String(instance.t(key as never, values as never));
  return Object.assign(lookup, {
    has: (key: string, values?: Record<string, string | number>): boolean =>
      instance.exists(key as never, values as never),
  });
}

type Wording = Pick<NotificationResponse, 'type' | 'title' | 'body' | 'data' | 'count'>;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const wholeCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

const firstText = (d: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = text(d[k]).trim();
    if (v) return v;
  }
  return '';
};

/** The types worded from a conversation's data (the other conversation-group types have no wording of their own yet). */
const CHAT_WORDED: readonly string[] = [
  'new_chat',
  'new_message',
  'chat_waiting',
  'conversation_assigned',
  'snooze_wake',
  'mention',
];

/** The longest preview a row shows. */
const PREVIEW_MAX = 80;

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

const rowCount = (n: Pick<NotificationResponse, 'data' | 'count'>): number => {
  const raw = n.count ?? n.data?.count;
  return typeof raw === 'number' && raw >= 1 ? Math.floor(raw) : 1;
};

export interface NotificationWords {
  title: string;
  body: string | null;
}

export function notificationText(t: Translator, n: Wording): NotificationWords {
  if (
    !isKnownType(n.type) ||
    !(
      t.has(`notifications.types.${n.type}.title`, { count: 1 }) ||
      t.has(`notifications.types.${n.type}.titleNoName`, { count: 1 })
    )
  )
    return { title: n.title, body: n.body };
  const base = `notifications.types.${n.type}`;
  const data = n.data ?? {};
  if (n.type === 'new_lead') return leadText(t, data);
  const group = groupOf(n.type);
  if (CHAT_WORDED.includes(n.type)) return conversationText(t, n, base);
  if (group === 'devices') return deviceText(t, n, base);
  if (group === 'broadcasts') return sendingText(t, n, base);
  if (group === 'team_chat') return teamChatText(t, n, base);
  if (group === 'whatsapp_groups') return groupText(t, n, base);
  const task = text(data.taskTitle);
  const actor = text(data.actorName);
  const body = actor
    ? t.has(`${base}.body`)
      ? t(`${base}.body`, { task, actor })
      : task
    : t.has(`${base}.bodyNoActor`)
      ? t(`${base}.bodyNoActor`, { task })
      : task;
  return { title: t(`${base}.title`), body: body || null };
}

/** The chat types: worded from the contact's name, the preview and how many messages the row stands for. Every field may be missing. */
function conversationText(t: Translator, n: Wording, base: string): NotificationWords {
  const d = n.data ?? {};
  const name = text(d.contactName).trim();
  const preview = clipPreview(d.preview);
  const count = rowCount(n);
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
    case 'snooze_wake': {
      const key = `${base}.${d.teamAssigned === true ? 'titleTeam' : 'title'}${name ? '' : 'NoName'}`;
      return { title: name ? t(key, { name }) : t(key), body: null };
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

/** A personal WhatsApp number: connected, dropped, or logged out from the phone. Named by its label (else its number). */
function deviceText(t: Translator, n: Wording, base: string): NotificationWords {
  const name = firstText(n.data ?? {}, 'deviceName', 'maskedNumber');
  return {
    title: name ? t(`${base}.title`, { name }) : t(`${base}.titleNoName`),
    body: t.has(`${base}.body`) ? t(`${base}.body`) : null,
  };
}

/** A broadcast, a campaign or a scheduled send that finished or failed, with how many went out and how many did not. */
function sendingText(t: Translator, n: Wording, base: string): NotificationWords {
  const d = n.data ?? {};
  const name = firstText(d, 'name');
  const sent = wholeCount(d.sent ?? d.delivered);
  const failed = wholeCount(d.failed);
  let body: string | null = null;
  if (n.type.endsWith('_failed')) {
    const reason = clipPreview(firstText(d, 'reason'));
    body = reason
      ? t.has(`${base}.body`)
        ? t(`${base}.body`, { reason })
        : reason
      : t.has(`${base}.bodyNoReason`)
        ? t(`${base}.bodyNoReason`)
        : null;
  } else if (sent !== null && failed !== null && failed > 0) {
    body = t(`${base}.bodySentFailed`, { count: sent, failed });
  } else if (sent !== null) {
    body = t(`${base}.bodySent`, { count: sent });
  }
  return { title: name ? t(`${base}.title`, { name }) : t(`${base}.titleNoName`), body };
}

/** A WhatsApp group: people asking to join (with how many), or the group being suspended or restored. Names and counts only. */
function groupText(t: Translator, n: Wording, base: string): NotificationWords {
  const name = firstText(n.data ?? {}, 'groupName');
  const count = rowCount(n);
  return {
    title: name ? t(`${base}.title`, { name, count }) : t(`${base}.titleNoName`, { count }),
    body: t.has(`${base}.body`) ? t(`${base}.body`) : null,
  };
}

/** Team chat: a colleague mentioned me in a channel, or wrote to me directly (collapsed rows carry a count). */
function teamChatText(t: Translator, n: Wording, base: string): NotificationWords {
  const d = n.data ?? {};
  const author = firstText(d, 'authorName');
  const channel = firstText(d, 'channelName');
  const count = rowCount(n);
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
  return { title, body: clipPreview(d.preview) || null };
}

/** A lead from a lead source: the contact's name and the platform it came from; a repeat says so. */
function leadText(t: Translator, data: Record<string, unknown>): NotificationWords {
  const name = text(data.contactName);
  const platform = text(data.platform);
  const returning = data.returning === true;
  const base = 'notifications.types.new_lead';
  const body = !name
    ? null
    : platform
      ? t(returning ? `${base}.bodyReturning` : `${base}.body`, { name, platform })
      : t(`${base}.bodyNoActor`, { name });
  return { title: t(returning ? `${base}.titleReturning` : `${base}.title`), body };
}

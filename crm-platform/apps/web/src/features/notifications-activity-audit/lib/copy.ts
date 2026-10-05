import { NOTIFICATION_TYPES, type NotificationResponse } from '@crm/contracts';

/** The slice of next-intl's translator these helpers need (so they can be tested without React). */
export interface Translator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

const KNOWN = new Set<string>(NOTIFICATION_TYPES);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * What a notification says, in the viewer's language. Types this build knows are worded from `data` through the
 * messages; any other type (a domain that started notifying after this build) shows the server's English wording.
 */
export function notificationText(
  t: Translator,
  n: Pick<NotificationResponse, 'type' | 'title' | 'body' | 'data'>,
): { title: string; body: string | null } {
  if (!KNOWN.has(n.type) || !t.has(`types.${n.type}.title`))
    return { title: n.title, body: n.body };
  if (n.type === 'new_lead') return leadText(t, n.data);
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

/**
 * Where a notification opens: an app path the server named. Anything else (an absolute URL, a protocol-relative one) is
 * ignored, so a bad row can never send the person off-site.
 */
export function safeLink(link: string | null): string | null {
  return link !== null && /^\/(?!\/)/.test(link) ? link : null;
}

/** "99+" past 99, nothing at 0. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

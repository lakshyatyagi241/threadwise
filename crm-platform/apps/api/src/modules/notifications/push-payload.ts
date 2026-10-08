import { createHash } from 'node:crypto';
import type { PushPayload } from '@crm/contracts';
import type { NotificationRow } from './notifications.repository';

/**
 * What a browser (Web Push) notification says. Pure functions over the bell row, so every rule is unit-tested without a browser or a
 * network (docs/specs/realtime-notifications.md section 18).
 *
 * Privacy (decision D4): a push payload crosses the browser vendor's push service, encrypted for the device (RFC 8291), and an OS
 * notification can show on a locked screen. So it carries the contact name and the kind of event, never the text of a message, and
 * nothing the bell row does not already hold: no phone number, no id other than the opaque notification uuid. Every field is cut to 80
 * characters. The wording is the server's English text, the same fallback the bell uses
 * for a type the web app has no copy for; a service worker cannot load the person's language files.
 */

export const PUSH_TEXT_MAX = 80;

const clip = (text: string, max = PUSH_TEXT_MAX): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * One OS notification per conversation: notifications with the same `tag` replace each other on the device (and `renotify` makes the
 * replacement alert again). Rows about something (a chat, a team chat channel) share the subject's tag; anything else gets its own.
 */
export function pushTag(
  row: Pick<NotificationRow, 'uuid' | 'subjectKind' | 'subjectUuid'>,
): string {
  if (row.subjectKind && row.subjectUuid) return `${row.subjectKind}:${row.subjectUuid}`;
  return `notification:${row.uuid}`;
}

/** The `Topic` header (RFC 8030): at most 32 URL-safe characters, so the tag is hashed. A newer push with it replaces an undelivered one. */
export function pushTopic(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

/** Only a path on this site may be opened by a click. Anything else (an absolute URL, `//host`, `javascript:`) becomes the home page. */
export function safePushLink(link: string | null | undefined): string {
  if (
    !link ||
    !link.startsWith('/') ||
    link.startsWith('//') ||
    link.includes(String.fromCharCode(92))
  )
    return '/';
  return link.slice(0, 500);
}

/** Types whose bell row names the contact: the push title is the contact name. */
const CONTACT_TITLED = new Set(['new_chat', 'new_message']);
/**
 * Types whose row body is somebody's words (a customer message, a note excerpt, a team chat message). An OS notification can show on a
 * locked screen, so by decision D4 of the spec these carry the name and the kind of event only, never the text.
 */
const TEXT_BEARING = new Set([
  'new_chat',
  'new_message',
  'mention',
  'teamchat_mention',
  'teamchat_message',
]);

/** Title and body of the OS notification for a bell row. */
export function pushText(
  row: Pick<NotificationRow, 'type' | 'title' | 'body' | 'data' | 'eventCount'>,
): {
  title: string;
  body: string;
} {
  const data = (row.data ?? {}) as Record<string, unknown>;
  if (CONTACT_TITLED.has(row.type)) {
    // "Title = contact name": who wrote, then what kind of event it is.
    const contact = str(data.contactName);
    const count = row.eventCount > 1 ? row.eventCount : 0;
    const body = count
      ? `${count} new messages`
      : row.type === 'new_chat'
        ? 'New chat'
        : 'New message';
    return { title: clip(contact ?? row.title), body };
  }
  return { title: clip(row.title), body: TEXT_BEARING.has(row.type) ? '' : clip(row.body ?? '') };
}

export function buildPushPayload(
  row: Pick<
    NotificationRow,
    | 'uuid'
    | 'type'
    | 'title'
    | 'body'
    | 'data'
    | 'eventCount'
    | 'link'
    | 'subjectKind'
    | 'subjectUuid'
  >,
  options: { silent?: boolean } = {},
): PushPayload {
  const text = pushText(row);
  return {
    v: 1,
    title: text.title,
    body: text.body,
    tag: pushTag(row),
    url: safePushLink(row.link),
    silent: options.silent === true,
    notificationId: row.uuid,
    test: false,
  };
}

/** The "Send a test notification" payload: never collapses with a real one. */
export function buildTestPayload(): PushPayload {
  return {
    v: 1,
    title: 'Test notification',
    body: 'Browser notifications are working on this device.',
    tag: 'test',
    url: '/account/notifications',
    silent: false,
    notificationId: null,
    test: true,
  };
}

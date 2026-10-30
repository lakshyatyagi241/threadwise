import type { RealtimeEventPayload } from '@crm/contracts';

/**
 * The pure parts of the in-app alert that drops down when a chat message arrives while the app is open. Ported from the web's live
 * toast (`notifications-activity-audit/live/model.ts`): the server's `notification.created` event says whether a pop-up is wanted
 * (`silent`, and the person's own `toast` preference), and the alert is left out when the person is already reading that chat.
 */

export type CreatedPayload = RealtimeEventPayload<'notification.created'>;

/** A burst of events becomes one read of the newest rows this long after the first of them. */
export const FLUSH_MS = 400;
/** How long the alert stays on screen before it goes by itself. */
export const ALERT_VISIBLE_MS = 5_000;

/** The kinds that are about a chat in the inbox: the only ones that drop down over the screen (a mention is hidden in the app). */
const INBOX_ALERT_TYPES: readonly string[] = [
  'new_chat',
  'new_message',
  'conversation_assigned',
  'chat_waiting',
  'snooze_wake',
];

export const isInboxAlertType = (type: string): boolean => INBOX_ALERT_TYPES.includes(type);

/**
 * Whether an event may drop down. `silent` (a burst inside the server's throttle window, a team-wide assignment) never does; the
 * flag the event carries already includes the person's preference, and an older server that sends none means "by type".
 */
export function wantsAlert(payload: Pick<CreatedPayload, 'type' | 'silent' | 'toast'>): boolean {
  if (payload.silent) return false;
  if (payload.toast === false) return false;
  return isInboxAlertType(payload.type);
}

const CONVERSATION_PATH = /^\/conversation\/([^/?#]+)/;

/** The chat the person has open, from the route (`/conversation/<id>`), or null on any other screen. */
export function openConversationId(pathname: string | null | undefined): string | null {
  const match = pathname ? CONVERSATION_PATH.exec(pathname) : null;
  return match?.[1] ? decodeURIComponent(match[1]).toLowerCase() : null;
}

/** True when the event is about the chat the person is reading right now: no alert, the thread itself already shows it. */
export function isReadingChat(
  pathname: string | null | undefined,
  subjectId: string | null | undefined,
): boolean {
  const open = openConversationId(pathname);
  return open !== null && !!subjectId && open === subjectId.toLowerCase();
}

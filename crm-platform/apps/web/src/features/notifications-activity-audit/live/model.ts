import type {
  NotificationListResponse,
  RealtimeEventPayload,
  NotificationResponse,
} from '@crm/contracts';
import { splitTitleBadge } from '@/lib/tab-title';
import { mayAlert, type PrefEntry } from '../prefs/model';

/**
 * The pure parts of the live notifications: how an event changes the cached bell, when a toast may show, how the tab title reads.
 * No React, no DOM and no clock of its own (time is passed in), so every rule is tested without a browser.
 */

export type CreatedPayload = RealtimeEventPayload<'notification.created'>;
export type ReadPayload = RealtimeEventPayload<'notification.read'>;

/** A burst of events becomes one refetch this long after the first of them. */
export const FLUSH_MS = 400;
/** One toast per conversation per this long; later ones wait and show the newest state. */
export const TOAST_PER_SUBJECT_MS = 3_000;
/** At most `TOAST_WINDOW_MAX` toasts per `TOAST_WINDOW_MS`; the rest become one summary. */
export const TOAST_WINDOW_MS = 10_000;
export const TOAST_WINDOW_MAX = 3;
/** The ping and the screen-reader announcement are each spaced at least this far apart. */
export const PING_MIN_GAP_MS = 3_000;
export const ANNOUNCE_MIN_GAP_MS = 3_000;

// --- caches -----------------------------------------------------------------------------------------------------------------

/**
 * The feed after the server said rows were read: those rows (or all of them) are marked read at `now` and the total is the
 * server's. Rows not in the cache are ignored; the same cache object is returned when nothing changes.
 */
export function feedAfterRead(
  feed: NotificationListResponse | undefined,
  payload: ReadPayload,
  now: string,
): NotificationListResponse | undefined {
  if (!feed) return feed;
  const ids = payload.notificationIds === 'all' ? null : new Set(payload.notificationIds);
  let changed = feed.meta.unread !== payload.unread;
  const data = feed.data.map((n) => {
    if (n.readAt !== null || (ids && !ids.has(n.id))) return n;
    changed = true;
    return { ...n, readAt: now };
  });
  return changed ? { ...feed, data, meta: { unread: payload.unread } } : feed;
}

/** The unread total after an event: the server's number as is (it is the truth), never below zero. */
export function unreadFrom(payload: { unread: number }): number {
  return Math.max(0, Math.floor(payload.unread));
}

// --- the person is looking at it ----------------------------------------------------------------------------------------------

/**
 * Whether the page the person is on is that conversation: the Inbox with the thread open (`/inbox?c=<uuid>`). The Inbox keeps the
 * open thread in the address, so this needs no shared store.
 */
export function isOnConversation(
  location: { pathname: string; search: string },
  conversationId: string | null | undefined,
): boolean {
  if (!conversationId) return false;
  if (location.pathname !== '/inbox' && !location.pathname.startsWith('/inbox/')) return false;
  const open = new URLSearchParams(location.search).get('c');
  return open !== null && open.toLowerCase() === conversationId.toLowerCase();
}

// --- tab title --------------------------------------------------------------------------------------------------------------

/** The title without a badge this module added. */
export function stripTitleBadge(title: string): string {
  return splitTitleBadge(title).base;
}

/** `(3) Inbox`; nothing in front at zero; `(99+)` past 99. A badge already there is replaced, never doubled. */
export function formatTitle(title: string, unread: number): string {
  const base = stripTitleBadge(title);
  if (unread <= 0) return base;
  return `(${unread > 99 ? '99+' : unread}) ${base}`;
}

// --- toast pacing -----------------------------------------------------------------------------------------------------------

export type ToastDecision =
  /** Show it now. */
  | { action: 'show' }
  /** This conversation toasted a moment ago: show the newest state after `waitMs`. */
  | { action: 'defer'; waitMs: number }
  /** Too many toasts in the window: count it in the one summary, shown after `waitMs`. */
  | { action: 'overflow'; waitMs: number };

/**
 * Decides when a toast may show. Per conversation: at most one per `TOAST_PER_SUBJECT_MS`. Overall: at most `TOAST_WINDOW_MAX` per
 * `TOAST_WINDOW_MS`, the rest folded into one "N new notifications". Time is an argument, so the rules are exact in tests.
 */
export class ToastPlanner {
  private readonly lastBySubject = new Map<string, number>();
  private shown: number[] = [];

  /** Asks. A `show` answer must be followed by `record`. */
  decide(subject: string, now: number): ToastDecision {
    this.shown = this.shown.filter((at) => now - at < TOAST_WINDOW_MS);
    const last = this.lastBySubject.get(subject);
    if (last !== undefined && now - last < TOAST_PER_SUBJECT_MS) {
      return { action: 'defer', waitMs: TOAST_PER_SUBJECT_MS - (now - last) };
    }
    if (this.shown.length >= TOAST_WINDOW_MAX) {
      return { action: 'overflow', waitMs: TOAST_WINDOW_MS - (now - this.shown[0]!) };
    }
    return { action: 'show' };
  }

  record(subject: string, now: number): void {
    this.lastBySubject.set(subject, now);
    this.shown.push(now);
    // Old subjects are forgotten so the map cannot grow for ever.
    if (this.lastBySubject.size > 200) {
      for (const [key, at] of this.lastBySubject) {
        if (now - at >= TOAST_PER_SUBJECT_MS) this.lastBySubject.delete(key);
      }
    }
  }
}

// --- the alert an event turns into ------------------------------------------------------------------------------------------

/** What a toast, an announcement and a desktop alert are built from: the fetched row, never the socket event. */
export interface LiveAlert {
  /** The notification id of the newest event this alert stands for (what tabs claim). */
  notificationId: string;
  /** Whether the ping plays for it: the type allows it and this person has not turned it off. */
  sound: boolean;
  /** Groups alerts of one conversation (its uuid), else the type. */
  subject: string;
  type: string;
  row: NotificationResponse;
  /** The app path the alert opens, or null. */
  href: string | null;
}

/**
 * Whether an event may raise a toast (`toast`) or the ping (`sound`). A `silent` event never does. The server's own answer (the
 * flag the event carries, which already includes the person's preferences) decides when present; an older server sends none and the
 * type's default applies, narrowed by the preferences already loaded in this tab.
 */
export function eventWants(
  payload: Pick<CreatedPayload, 'type' | 'silent' | 'toast' | 'sound'>,
  channel: 'toast' | 'sound',
  prefs: readonly PrefEntry[] | undefined,
): boolean {
  if (payload.silent) return false;
  const explicit = payload[channel];
  return explicit !== undefined ? explicit : mayAlert(prefs, payload.type, channel);
}

/** The last item per key, ordered by when each key last appeared (a collapsed row replaced the earlier ones). */
export function newestBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    byKey.delete(k);
    byKey.set(k, item);
  }
  return [...byKey.values()];
}

/** Of a batch of events, the newest per conversation (events with no subject group by type). */
export function newestPerSubject<T extends { subjectId: string | null; type: string }>(
  events: readonly T[],
): T[] {
  return newestBy(events, (e) => e.subjectId ?? `type:${e.type}`);
}

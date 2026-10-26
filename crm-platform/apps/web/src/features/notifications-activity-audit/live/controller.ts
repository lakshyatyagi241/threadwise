import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENT,
  type NotificationListResponse,
  type RealtimeEnvelope,
} from '@crm/contracts';
import type { RealtimeClient } from '@/lib/realtime';
import { NOTIFICATION_KEYS } from '../api/keys';
import { notificationHref } from '../lib/catalogue';
import type { PrefEntry } from '../prefs/model';
import type { EventClaimer } from './claim';
import {
  ANNOUNCE_MIN_GAP_MS,
  FLUSH_MS,
  ToastPlanner,
  eventWants,
  feedAfterRead,
  isOnConversation,
  newestBy,
  newestPerSubject,
  unreadFrom,
  type CreatedPayload,
  type LiveAlert,
  type ReadPayload,
} from './model';

/** The inbox's own counters live in its screen; this key is what a shell badge reads (nothing observes it yet, so it costs nothing). */
export const INBOX_COUNTS_KEY = ['inbox', 'counts'] as const;

const FEED_SIZE = 8;
/** A failed fetch of the newest rows is tried once more after this long before the toast falls back to the generic words. */
export const FEED_RETRY_MS = 1_500;
/** The most toasts a hidden tab keeps for when it comes back; past this only the count grows. */
const PARKED_MAX = 50;
/** The Inbox page marks a thread read itself; this guard waits a moment so a burst makes one call. */
const READ_GUARD_MS = 1_000;

/** What the controller needs from the outside world; each has a real implementation in the provider and a fake in tests. */
export interface LiveEnv {
  isVisible(): boolean;
  /** Calls `listener` whenever the tab comes to the front. Returns the way to stop. Absent: a hidden tab never shows its toast later. */
  onVisible?(listener: () => void): () => void;
  location(): { pathname: string; search: string };
  now(): number;
}

export interface LiveApi {
  list(limit: number, signal?: AbortSignal): Promise<NotificationListResponse>;
  readSubject(id: string): Promise<unknown>;
}

/** How the person is told. The provider renders these in the viewer's language; tests record them. */
export interface LivePresenter {
  /**
   * A toast in the page (tab visible). `summary` is the "N new notifications" overflow toast; `generic` is the fallback when the row
   * itself could not be fetched ("You have a new notification" for one, the count for several): never nothing.
   */
  toast(
    toast:
      | { kind: 'alert'; alert: LiveAlert }
      | { kind: 'summary'; count: number }
      | { kind: 'generic'; count: number },
  ): void;
  /** A screen-reader announcement (a polite live region), already spaced and batched. */
  announce(alerts: readonly LiveAlert[]): void;
  /** The desktop (OS) alert for a tab in the background: contact name only. */
  desktop(alert: LiveAlert): void;
  /** The short ping. */
  ping(): void;
}

export interface LiveSettings {
  soundOn(): boolean;
  desktopOn(): boolean;
  /**
   * True when a browser push (an OS notification from the service worker) already covers a background tab for this type on this
   * device, so the in-page desktop alert is left out: otherwise a hidden tab would show the same event twice.
   */
  pushCovers?(type: string): boolean;
}

export interface LiveOptions {
  /** The person's loaded preferences, if any (read when an event arrives, so a saved change applies at once). */
  prefs?: () => readonly PrefEntry[] | undefined;
  client: Pick<RealtimeClient, 'subscribe' | 'onResync'>;
  qc: QueryClient;
  api: LiveApi;
  presenter: LivePresenter;
  settings: LiveSettings;
  claimer: Pick<EventClaimer, 'claim'>;
  env: LiveEnv;
}

type Timer = ReturnType<typeof setTimeout>;

/** The planner key of the generic ("you have a new notification") toast: it is paced like one conversation. */
const GENERIC_SUBJECT = 'generic';

/** One toast waiting to be paced: a fetched row, or the generic words for events whose row could not be shown. */
type ToastItem =
  | { kind: 'alert'; subject: string; alert: LiveAlert }
  | { kind: 'generic'; subject: string; count: number };

/**
 * Turns the socket's hints into what the person sees, on every page. It reads events from the one shared socket, keeps the bell's
 * react-query caches in step at once (the unread total is the server's own number), and a few hundred milliseconds later (one pass
 * for any burst) fetches the newest rows and raises the toast, the ping, the announcement or the desktop alert.
 *
 * It holds no React state: the provider creates one, starts it, and stops it on unmount.
 */
export class LiveNotificationsController {
  private readonly planner = new ToastPlanner();
  private pending: CreatedPayload[] = [];
  private flushTimer: Timer | undefined;
  private inboxTimer: Timer | undefined;
  private resyncTimer: Timer | undefined;
  private overviewTimer: Timer | undefined;
  private readTimer: Timer | undefined;
  private readonly readSubjects = new Set<string>();
  private readonly deferred = new Map<string, Timer>();
  private readonly deferredItems = new Map<string, ToastItem>();
  /** What a hidden tab could not show: shown as one toast (or the one alert) when the tab is in front again and the rows are still unread. */
  private parked = new Map<string, ToastItem>();
  private parkedExtra = 0;
  private retryTimer: Timer | undefined;
  private overflow = 0;
  private overflowTimer: Timer | undefined;
  private announceQueue: LiveAlert[] = [];
  private announceTimer: Timer | undefined;
  private lastAnnounceAt = -Infinity;
  private readonly seen = new Set<string>();
  private stops: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly o: LiveOptions) {}

  start(): void {
    const { client } = this.o;
    this.stops.push(
      client.subscribe(REALTIME_EVENT.notificationCreated, (e) =>
        this.onCreated(e as RealtimeEnvelope<CreatedPayload>),
      ),
      client.subscribe(REALTIME_EVENT.notificationRead, (e) =>
        this.onRead((e as RealtimeEnvelope<ReadPayload>).payload),
      ),
      // The inbox's own signals (already sent to this person) keep any shell counter fresh on pages without the Inbox.
      client.subscribe(REALTIME_EVENT.unread, () => this.scheduleInbox()),
      client.subscribe(REALTIME_EVENT.conversationUpsert, () => this.scheduleInbox()),
      client.subscribe(REALTIME_EVENT.assignment, () => this.scheduleInbox()),
      // After a reconnect, a sequence gap, or coming back to the tab the socket may have missed rows: ask the server once.
      client.onResync((request) => {
        if (request.room === 'user') this.scheduleResync();
      }),
    );
    const stopVisible = this.o.env.onVisible?.(() => this.showParked());
    if (stopVisible) this.stops.push(stopVisible);
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.stops) s();
    this.stops = [];
    for (const t of [
      this.flushTimer,
      this.inboxTimer,
      this.resyncTimer,
      this.overviewTimer,
      this.readTimer,
      this.overflowTimer,
      this.announceTimer,
      this.retryTimer,
      ...this.deferred.values(),
    ]) {
      clearTimeout(t);
    }
    this.deferred.clear();
    this.deferredItems.clear();
    this.parked.clear();
    this.pending = [];
    this.announceQueue = [];
  }

  // --- events ---------------------------------------------------------------------------------------------------------------

  private onCreated(envelope: RealtimeEnvelope<CreatedPayload>): void {
    const payload = envelope.payload;
    // Delivery is at least once: a repeat of the same event changes nothing.
    if (this.seen.has(envelope.id)) return;
    this.seen.add(envelope.id);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string);

    // The badge moves at once, to the server's own number (never "+1" on our side, so a lost or repeated event cannot drift it).
    this.o.qc.setQueryData<number>(NOTIFICATION_KEYS.unread, unreadFrom(payload));
    this.scheduleOverview();

    // The person is reading this very conversation: no toast, ping or alert (see `flush`), and the rows are marked read so the badge settles.
    if (this.isLookingAt(payload)) this.scheduleRead(payload.subjectId!);
    this.pending.push(payload);
    this.flushTimer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  private onRead(payload: ReadPayload): void {
    const { qc, env } = this.o;
    qc.setQueryData<number>(NOTIFICATION_KEYS.unread, unreadFrom(payload));
    qc.setQueryData<NotificationListResponse | undefined>(NOTIFICATION_KEYS.feed, (feed) =>
      feedAfterRead(feed, payload, new Date(env.now()).toISOString()),
    );
    this.scheduleOverview();
  }

  private isLookingAt(p: Pick<CreatedPayload, 'subjectKind' | 'subjectId'>): boolean {
    return (
      p.subjectKind === 'conversation' &&
      this.o.env.isVisible() &&
      isOnConversation(this.o.env.location(), p.subjectId)
    );
  }

  /** Toast / ping for an event: the server's flag, else the type's default narrowed by the preferences already loaded. */
  private wants(p: CreatedPayload, channel: 'toast' | 'sound'): boolean {
    return eventWants(p, channel, this.o.prefs?.());
  }

  private scheduleInbox(): void {
    this.inboxTimer ??= setTimeout(() => {
      this.inboxTimer = undefined;
      void this.o.qc.invalidateQueries({ queryKey: INBOX_COUNTS_KEY });
    }, FLUSH_MS);
  }

  /**
   * The Notifications page's overview tiles (unread, last day, last week, total) and its list live under the feed key, not the badge
   * key, so a new or read row has to refresh them as well. The prefix covers all of them; a burst waits one pass, like the inbox counts.
   */
  private scheduleOverview(): void {
    this.overviewTimer ??= setTimeout(() => {
      this.overviewTimer = undefined;
      void this.o.qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.feed });
    }, FLUSH_MS);
  }

  private scheduleResync(): void {
    this.resyncTimer ??= setTimeout(() => {
      this.resyncTimer = undefined;
      void this.o.qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread });
      void this.o.qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.feed });
      void this.o.qc.invalidateQueries({ queryKey: INBOX_COUNTS_KEY });
    }, FLUSH_MS);
  }

  private scheduleRead(conversationId: string): void {
    this.readSubjects.add(conversationId);
    this.readTimer ??= setTimeout(() => {
      this.readTimer = undefined;
      const ids = [...this.readSubjects];
      this.readSubjects.clear();
      for (const id of ids) this.o.api.readSubject(id).catch(() => undefined);
    }, READ_GUARD_MS);
  }

  // --- one pass for a burst -------------------------------------------------------------------------------------------------

  private async flush(): Promise<void> {
    this.flushTimer = undefined;
    const batch = this.pending;
    this.pending = [];
    if (this.stopped || batch.length === 0) return;
    const { qc } = this.o;

    void qc.invalidateQueries({ queryKey: INBOX_COUNTS_KEY });
    const candidates = newestPerSubject(
      batch.filter((p) => this.wants(p, 'toast') && !this.isLookingAt(p)),
    );
    if (candidates.length === 0) {
      // Nothing to tell: keep the list right if it is on screen (a list nobody watches is only marked stale).
      void qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.feed });
      return;
    }

    // The words come from the fetched rows, never from the socket. The fetch also fills the bell's list.
    const feed = await this.loadFeed();
    if (this.stopped) return;

    const alerts: LiveAlert[] = [];
    // Events whose row could not be shown (the fetch failed twice, or the row is no longer among the newest): they still get a toast,
    // in generic words, as long as the badge says something is unread and the person is not reading that conversation.
    const generic: Array<{
      notificationId: string;
      sound: boolean;
      type: string;
      subject: string;
    }> = [];
    const unreadNow = qc.getQueryData<number>(NOTIFICATION_KEYS.unread);
    for (const c of candidates) {
      const subject = c.subjectId ?? `type:${c.type}`;
      const row = feed
        ? (feed.data.find((n) => n.id === c.notificationId) ??
          // A later event collapsed this one into a newer row of the same conversation.
          feed.data.find((n) => c.subjectId !== null && n.subject?.id === c.subjectId))
        : undefined;
      if (row) {
        // Read elsewhere in the meantime: nothing left to tell.
        if (row.readAt !== null) continue;
        alerts.push({
          notificationId: c.notificationId,
          sound: this.wants(c, 'sound'),
          subject,
          type: c.type,
          row,
          href: notificationHref(row),
        });
      } else if ((unreadNow === undefined || unreadNow > 0) && !this.isLookingAt(c)) {
        generic.push({
          notificationId: c.notificationId,
          sound: this.wants(c, 'sound'),
          type: c.type,
          subject,
        });
      }
    }
    if (alerts.length > 0 || generic.length > 0) await this.alert(alerts, generic);
  }

  /** The newest rows, tried twice (a short pause between) so one dropped request does not cost the toast. Null when both failed. */
  private async loadFeed(): Promise<NotificationListResponse | null> {
    const { qc } = this.o;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await qc.fetchQuery({
          queryKey: NOTIFICATION_KEYS.feed,
          queryFn: ({ signal }) => this.o.api.list(FEED_SIZE, signal),
          staleTime: 0,
        });
      } catch {
        if (attempt === 1 || this.stopped) break;
        await new Promise<void>((resolve) => {
          this.retryTimer = setTimeout(resolve, FEED_RETRY_MS);
        });
        if (this.stopped) break;
      }
    }
    return null;
  }

  private async alert(
    alerts: LiveAlert[],
    generic: Array<{ notificationId: string; sound: boolean; type: string; subject: string }>,
  ): Promise<void> {
    const { env, presenter, settings, claimer } = this.o;
    const visible = env.isVisible();
    const everyone = [
      ...alerts.map((a) => ({ id: a.notificationId, sound: a.sound, type: a.type, alert: a })),
      ...generic.map((g) => ({ id: g.notificationId, sound: g.sound, type: g.type, alert: null })),
    ];

    // The sound and the desktop alert belong to one tab (the first to claim the event); the toast and the title belong to each.
    const claimed = await Promise.all(everyone.map((a) => claimer.claim(`alert:${a.id}`, visible)));
    if (this.stopped) return;
    let pinged = false;
    everyone.forEach((a, i) => {
      if (!claimed[i]) return;
      if (a.sound && settings.soundOn() && !pinged) {
        pinged = true;
        presenter.ping();
      }
      // The desktop alert names the contact from the row; with no row there is nothing safe to say, so the title badge stands in.
      if (a.alert && !visible && settings.desktopOn() && !settings.pushCovers?.(a.type)) {
        presenter.desktop(a.alert);
      }
    });

    const items: ToastItem[] = [
      ...alerts.map((alert): ToastItem => ({ kind: 'alert', subject: alert.subject, alert })),
      ...(generic.length > 0
        ? [{ kind: 'generic', subject: GENERIC_SUBJECT, count: generic.length } as ToastItem]
        : []),
    ];
    // A hidden tab gets the title badge (always) and the desktop alert (if allowed), not a toast nobody can see. What it could not
    // show is kept and shown once, when the tab comes back, if it is still unread.
    if (!env.isVisible()) {
      this.park(items);
      return;
    }
    if (alerts.length > 0) this.queueAnnouncement(alerts);
    for (const item of items) this.toast(item);
  }

  // --- a hidden tab, then the person comes back ------------------------------------------------------------------------------

  private park(items: readonly ToastItem[]): void {
    for (const item of items) {
      const prior = this.parked.get(item.subject);
      this.parked.delete(item.subject);
      if (item.kind === 'generic' && prior?.kind === 'generic') {
        this.parked.set(item.subject, { ...item, count: item.count + prior.count });
      } else {
        this.parked.set(item.subject, item);
      }
      if (this.parked.size > PARKED_MAX) {
        this.parked.delete(this.parked.keys().next().value as string);
        this.parkedExtra += 1;
      }
    }
  }

  /** The tab is in front again: show what it missed, as one alert or one "N new notifications", unless it was all read meanwhile. */
  private showParked(): void {
    if (this.stopped || this.parked.size === 0) return;
    const items = [...this.parked.values()];
    const extra = this.parkedExtra;
    this.parked.clear();
    this.parkedExtra = 0;
    const { qc } = this.o;
    if (qc.getQueryData<number>(NOTIFICATION_KEYS.unread) === 0) return;
    const feed = qc.getQueryData<NotificationListResponse>(NOTIFICATION_KEYS.feed);
    const stillUnread = items.filter((item) => {
      if (item.kind !== 'alert') return true;
      const now = feed?.data.find((n) => n.id === item.alert.row.id);
      return !now || now.readAt === null;
    });
    if (stillUnread.length === 0) return;
    const total =
      stillUnread.reduce((n, item) => n + (item.kind === 'generic' ? item.count : 1), 0) + extra;
    const only = stillUnread[0]!;
    if (stillUnread.length === 1 && extra === 0) {
      if (only.kind === 'alert') this.queueAnnouncement([only.alert]);
      this.toast(only);
    } else {
      this.toast({ kind: 'generic', subject: GENERIC_SUBJECT, count: total });
    }
  }

  // --- toasts, paced ---------------------------------------------------------------------------------------------------------

  private toast(item: ToastItem): void {
    const now = this.o.env.now();
    const decision = this.planner.decide(item.subject, now);
    if (decision.action === 'show') {
      this.planner.record(item.subject, now);
      this.show(item);
    } else if (decision.action === 'defer') {
      // The newest state of this conversation shows once its window has passed; a later event replaces the waiting one.
      const waiting = this.deferredItems.get(item.subject);
      clearTimeout(this.deferred.get(item.subject));
      const next =
        item.kind === 'generic' && waiting?.kind === 'generic'
          ? { ...item, count: item.count + waiting.count }
          : item;
      this.deferredItems.set(item.subject, next);
      this.deferred.set(
        item.subject,
        setTimeout(() => {
          this.deferred.delete(item.subject);
          const due = this.deferredItems.get(item.subject);
          this.deferredItems.delete(item.subject);
          if (due && !this.stopped && this.o.env.isVisible()) this.toast(due);
        }, decision.waitMs),
      );
    } else {
      this.overflow += item.kind === 'generic' ? item.count : 1;
      this.overflowTimer ??= setTimeout(() => {
        this.overflowTimer = undefined;
        const count = this.overflow;
        this.overflow = 0;
        if (!this.stopped && count > 0 && this.o.env.isVisible()) {
          this.o.presenter.toast({ kind: 'summary', count });
        }
      }, decision.waitMs);
    }
  }

  private show(item: ToastItem): void {
    this.o.presenter.toast(
      item.kind === 'alert'
        ? { kind: 'alert', alert: item.alert }
        : { kind: 'generic', count: item.count },
    );
  }

  // --- announcements, spaced -------------------------------------------------------------------------------------------------

  private queueAnnouncement(alerts: readonly LiveAlert[]): void {
    this.announceQueue.push(...alerts);
    const wait = Math.max(0, this.lastAnnounceAt + ANNOUNCE_MIN_GAP_MS - this.o.env.now());
    if (wait === 0) {
      this.sendAnnouncement();
    } else {
      this.announceTimer ??= setTimeout(() => {
        this.announceTimer = undefined;
        this.sendAnnouncement();
      }, wait);
    }
  }

  private sendAnnouncement(): void {
    if (this.stopped || this.announceQueue.length === 0) return;
    const queue = newestBy(this.announceQueue, (a) => a.subject);
    this.announceQueue = [];
    this.lastAnnounceAt = this.o.env.now();
    this.o.presenter.announce(queue);
  }
}

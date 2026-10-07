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
/** The Inbox page marks a thread read itself; this guard waits a moment so a burst makes one call. */
const READ_GUARD_MS = 1_000;

/** What the controller needs from the outside world; each has a real implementation in the provider and a fake in tests. */
export interface LiveEnv {
  isVisible(): boolean;
  location(): { pathname: string; search: string };
  now(): number;
}

export interface LiveApi {
  list(limit: number, signal?: AbortSignal): Promise<NotificationListResponse>;
  readSubject(id: string): Promise<unknown>;
}

/** How the person is told. The provider renders these in the viewer's language; tests record them. */
export interface LivePresenter {
  /** A toast in the page (tab visible). `summary` is the "N new notifications" overflow toast. */
  toast(toast: { kind: 'alert'; alert: LiveAlert } | { kind: 'summary'; count: number }): void;
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
  private readTimer: Timer | undefined;
  private readonly readSubjects = new Set<string>();
  private readonly deferred = new Map<string, Timer>();
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
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.stops) s();
    this.stops = [];
    for (const t of [
      this.flushTimer,
      this.inboxTimer,
      this.resyncTimer,
      this.readTimer,
      this.overflowTimer,
      this.announceTimer,
      ...this.deferred.values(),
    ]) {
      clearTimeout(t);
    }
    this.deferred.clear();
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
    let feed: NotificationListResponse;
    try {
      feed = await qc.fetchQuery({
        queryKey: NOTIFICATION_KEYS.feed,
        queryFn: ({ signal }) => this.o.api.list(FEED_SIZE, signal),
        staleTime: 0,
      });
    } catch {
      return;
    }
    if (this.stopped) return;

    const alerts: LiveAlert[] = [];
    for (const c of candidates) {
      const row =
        feed.data.find((n) => n.id === c.notificationId) ??
        // A later event collapsed this one into a newer row of the same conversation.
        feed.data.find((n) => c.subjectId !== null && n.subject?.id === c.subjectId);
      if (!row || row.readAt !== null) continue;
      alerts.push({
        notificationId: c.notificationId,
        sound: this.wants(c, 'sound'),
        subject: c.subjectId ?? `type:${c.type}`,
        type: c.type,
        row,
        href: notificationHref(row),
      });
    }
    if (alerts.length > 0) await this.alert(alerts);
  }

  private async alert(alerts: LiveAlert[]): Promise<void> {
    const { env, presenter, settings, claimer } = this.o;
    const visible = env.isVisible();

    // The sound and the desktop alert belong to one tab (the first to claim the event); the toast and the title belong to each.
    const claimed = await Promise.all(
      alerts.map((a) => claimer.claim(`alert:${a.notificationId}`, visible)),
    );
    if (this.stopped) return;
    let pinged = false;
    alerts.forEach((a, i) => {
      if (!claimed[i]) return;
      if (a.sound && settings.soundOn() && !pinged) {
        pinged = true;
        presenter.ping();
      }
      if (!visible && settings.desktopOn()) presenter.desktop(a);
    });

    // A hidden tab gets the title badge (always) and the desktop alert (if allowed), not a toast nobody can see.
    if (!env.isVisible()) return;
    this.queueAnnouncement(alerts);
    for (const a of alerts) this.toast(a);
  }

  // --- toasts, paced ---------------------------------------------------------------------------------------------------------

  private toast(alert: LiveAlert): void {
    const now = this.o.env.now();
    const decision = this.planner.decide(alert.subject, now);
    if (decision.action === 'show') {
      this.planner.record(alert.subject, now);
      this.o.presenter.toast({ kind: 'alert', alert });
    } else if (decision.action === 'defer') {
      // The newest state of this conversation shows once its window has passed; a later event replaces the waiting one.
      clearTimeout(this.deferred.get(alert.subject));
      this.deferred.set(
        alert.subject,
        setTimeout(() => {
          this.deferred.delete(alert.subject);
          if (!this.stopped && this.o.env.isVisible()) this.toast(alert);
        }, decision.waitMs),
      );
    } else {
      this.overflow += 1;
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

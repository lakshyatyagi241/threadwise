import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  OPERATOR_NOTIFICATION_TYPES,
  type OperatorNotification,
  type OperatorNotificationType,
  type OperatorNotificationsPage,
  type OperatorNotificationsQuery,
  type OperatorNotificationsRecent,
} from '@crm/contracts';
import { PlatformSettingsService, PlatformStore } from '../auth';
import {
  BELL_LIMIT,
  PAGE_LIMIT,
  PER_KIND_LIMIT,
  STATS_DAYS,
  matchesQuery,
  merge,
  money,
  seenAt,
  type FeedRow,
} from './operator-notification-rules';

/** Platform setting holding `{ "<operatorId>": "<iso>" }`: the last time each operator looked at the feed. */
export const NOTIF_SEEN_SETTING = 'shell.notif_seen';

/** English headlines, for the page's free-text filter (the screen words its own, per language). */
const TITLES: Record<OperatorNotification['titleKey'], string> = {
  signup: 'New signup',
  paymentReceived: 'Payment received',
  newOrder: 'New order',
  newTicket: 'New support ticket',
  newContactMessage: 'New contact message',
  newWorkspace: 'New workspace',
};

interface Raw {
  uuid: string;
  at: Date | string;
  a: string | null;
  b: string | null;
  paid?: boolean;
}

/**
 * The console's platform notification feed (TW-ASHELL-006). Like Reference it keeps no notifications of its own: it reads what
 * happened across every workspace (sign-ups, orders, tickets, contact messages, new workspaces) through the platform door and
 * compares each event with the operator's last-seen marker. Read-only apart from that marker, so there is nothing to audit.
 */
@Injectable()
export class OperatorNotificationsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly settings: PlatformSettingsService,
  ) {}

  async recent(operatorId: number, now = new Date()): Promise<OperatorNotificationsRecent> {
    const seen = await this.seen(operatorId, now);
    const rows = await this.read(OPERATOR_NOTIFICATION_TYPES);
    const all = merge(rows, seen, Number.MAX_SAFE_INTEGER);
    return {
      items: all.slice(0, BELL_LIMIT),
      // The badge counts every unread event the feed reads, not only the fifteen the bell lists.
      unread: all.filter((n) => n.unread).length,
    };
  }

  /** Opening the page marks everything seen, as Reference does (after the unread dots were computed). */
  async page(
    operatorId: number,
    query: OperatorNotificationsQuery,
    now = new Date(),
  ): Promise<OperatorNotificationsPage> {
    const seen = await this.seen(operatorId, now);
    const kinds: readonly OperatorNotificationType[] =
      query.type === 'all' ? OPERATOR_NOTIFICATION_TYPES : [query.type];
    const [rows, stats] = await Promise.all([this.read(kinds), this.stats(now)]);
    const items = merge(rows, seen, PAGE_LIMIT).filter((n) => matchesQuery(n, TITLES, query.q));
    await this.markSeen(operatorId, now);
    return { items, stats };
  }

  /** "Mark all read" and "Clear all" are the same act on a live feed: move the marker to now. */
  async markSeen(operatorId: number, now = new Date()): Promise<{ unread: 0 }> {
    await this.settings.mergeDocument(
      NOTIF_SEEN_SETTING,
      { [String(operatorId)]: now.toISOString() },
      operatorId,
    );
    return { unread: 0 };
  }

  private async seen(operatorId: number, now: Date): Promise<Date> {
    const doc = await this.settings.get<Record<string, unknown>>(NOTIF_SEEN_SETTING);
    return seenAt(doc?.[String(operatorId)], now);
  }

  private async stats(now: Date): Promise<OperatorNotificationsPage['stats']> {
    const since = new Date(now.getTime() - STATS_DAYS * 86_400_000).toISOString();
    const res = await this.store.tx((tx) =>
      tx.execute(sql`
        SELECT
          (SELECT count(*) FROM users WHERE created_at >= ${since}) AS signup,
          (SELECT count(*) FROM orders WHERE created_at >= ${since}) AS payment,
          (SELECT count(*) FROM support_tickets WHERE created_at >= ${since}) AS ticket,
          (SELECT count(*) FROM contact_messages WHERE created_at >= ${since}) AS contact,
          (SELECT count(*) FROM organizations WHERE created_at >= ${since}) AS workspace
      `),
    );
    const r = res.rows[0] as Record<OperatorNotificationType, string>;
    const counts = {
      signup: Number(r.signup ?? 0),
      payment: Number(r.payment ?? 0),
      ticket: Number(r.ticket ?? 0),
      contact: Number(r.contact ?? 0),
      workspace: Number(r.workspace ?? 0),
    };
    return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  /** The newest rows of each wanted kind. Every table is read in one platform transaction. */
  private async read(kinds: readonly OperatorNotificationType[]): Promise<FeedRow[]> {
    const want = new Set(kinds);
    return this.store.tx(async (tx) => {
      const out: FeedRow[] = [];
      const take = (type: OperatorNotificationType, rows: Raw[]) => {
        for (const r of rows) {
          out.push({
            type,
            uuid: r.uuid,
            at: r.at instanceof Date ? r.at : new Date(r.at),
            a: r.a,
            b: r.b,
            ...(r.paid === undefined ? {} : { paid: r.paid }),
          });
        }
      };
      const q = async (query: ReturnType<typeof sql>) =>
        (await tx.execute(query)).rows as unknown as Raw[];

      if (want.has('signup')) {
        take(
          'signup',
          await q(sql`
            SELECT uuid::text AS uuid, created_at AS at, full_name AS a, email::text AS b
              FROM users ORDER BY created_at DESC, id DESC LIMIT ${PER_KIND_LIMIT}`),
        );
      }
      if (want.has('payment')) {
        const rows = (
          await tx.execute(sql`
            SELECT uuid::text AS uuid, COALESCE(paid_at, created_at) AS at, order_number AS a,
                   currency, total_amount::text AS total, (status = 'paid') AS paid
              FROM orders ORDER BY COALESCE(paid_at, created_at) DESC, id DESC LIMIT ${PER_KIND_LIMIT}`)
        ).rows as unknown as Array<Raw & { currency: string | null; total: string | null }>;
        take(
          'payment',
          rows.map((r) => ({ ...r, a: `#${r.a}`, b: money(r.currency, r.total) })),
        );
      }
      if (want.has('ticket')) {
        take(
          'ticket',
          await q(sql`
            SELECT uuid::text AS uuid, created_at AS at, subject AS a, ticket_number AS b
              FROM support_tickets ORDER BY created_at DESC, id DESC LIMIT ${PER_KIND_LIMIT}`),
        );
      }
      if (want.has('contact')) {
        take(
          'contact',
          await q(sql`
            SELECT uuid::text AS uuid, created_at AS at, name AS a, topic AS b
              FROM contact_messages ORDER BY created_at DESC, id DESC LIMIT ${PER_KIND_LIMIT}`),
        );
      }
      if (want.has('workspace')) {
        take(
          'workspace',
          await q(sql`
            SELECT uuid::text AS uuid, created_at AS at, name AS a, NULL::text AS b
              FROM organizations ORDER BY created_at DESC, id DESC LIMIT ${PER_KIND_LIMIT}`),
        );
      }
      return out;
    });
  }
}

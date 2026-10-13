import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  ListScheduleRecipientsQuery,
  ScheduleFunnel,
  ScheduleRecipientList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

type Raw = Record<string, unknown>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number => Number(v ?? 0);

const HOUR = 3_600_000;
/** More than two days of activity is drawn by the day, and a bucket count is capped so a long recurring schedule stays readable. */
const HOURLY_UP_TO_MS = 48 * HOUR;
const MAX_POINTS = 120;

/** `status` filter to the recipient statuses it stands for. `sent` is "reached the provider and nothing more yet". */
const STATUS_FILTER: Record<ListScheduleRecipientsQuery['status'], SQL | null> = {
  all: null,
  pending: sql`c.status IN ('pending', 'processing')`,
  sent: sql`c.status = 'sent'`,
  delivered: sql`c.status = 'delivered'`,
  read: sql`c.status = 'read'`,
  failed: sql`c.status = 'failed'`,
};

/**
 * What the detail page shows about how a schedule landed (TW-SCHED-012): the delivery funnel over time and the per-recipient table.
 * Both are read from the recipient rows (their stored statuses and times), never from the counters on the schedule, so they agree
 * with each other and with what the provider reported.
 */
@Injectable()
export class ScheduleEngagementService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Queued, sent, delivered, read and failed as running totals at the start of each hour (or day), from the first message to the
   * last event. `queued` is whoever has not been sent or failed yet. A recurring schedule shows its latest occurrence (the recipient
   * rows are put back to pending when the next one starts).
   */
  async funnel(uuid: string): Promise<ScheduleFunnel> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const own = await tx.execute(sql`
        SELECT id FROM scheduled_messages WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
      const id = (own.rows[0] as { id: number | string } | undefined)?.id;
      if (id === undefined) throw AppError.notFound('Schedule', uuid);
      const span = await tx.execute(sql`
        SELECT count(*)::int AS total,
               min(least(sent_at, failed_at, delivered_at, read_at)) AS first_at,
               max(greatest(sent_at, failed_at, delivered_at, read_at)) AS last_at
          FROM scheduled_message_contacts WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)}`);
      const s = span.rows[0] as Raw;
      const total = num(s.total);
      if (!s.first_at) return { bucket: 'hour', total, points: [] };

      const first = new Date(s.first_at as string).getTime();
      const last = new Date(s.last_at as string).getTime();
      const bucket: ScheduleFunnel['bucket'] = last - first <= HOURLY_UP_TO_MS ? 'hour' : 'day';
      const unit = sql.raw(`'${bucket}'`);
      // One pass: how many recipients reached each step in each bucket. A step is counted once per recipient, at the time it happened.
      const rows = await tx.execute(sql`
        SELECT step, to_char(date_trunc(${unit}, at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b, count(*)::int AS n FROM (
          SELECT 'sent' AS step, sent_at AS at FROM scheduled_message_contacts
           WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} AND sent_at IS NOT NULL
          UNION ALL
          SELECT 'delivered', delivered_at FROM scheduled_message_contacts
           WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} AND delivered_at IS NOT NULL
          UNION ALL
          SELECT 'read', read_at FROM scheduled_message_contacts
           WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} AND read_at IS NOT NULL
          UNION ALL
          SELECT 'failed', failed_at FROM scheduled_message_contacts
           WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} AND failed_at IS NOT NULL AND status = 'failed'
        ) e GROUP BY 1, 2 ORDER BY 2`);
      // A recipient that failed without ever being sent leaves the queue at the failure; one that failed after a send already left it.
      const unsent = await tx.execute(sql`
        SELECT to_char(date_trunc(${unit}, failed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b, count(*)::int AS n
          FROM scheduled_message_contacts
         WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} AND status = 'failed'
           AND sent_at IS NULL AND failed_at IS NOT NULL
         GROUP BY 1`);

      const step = bucket === 'hour' ? HOUR : 24 * HOUR;
      const key = (d: unknown) => new Date(String(d)).getTime();
      const startAt = Math.floor(first / step) * step;
      const endAt = Math.floor(last / step) * step;
      const count = Math.min(MAX_POINTS, Math.floor((endAt - startAt) / step) + 1);
      // When the window is longer than the cap, keep the latest buckets (the first ones are folded into the starting totals).
      const from = endAt - (count - 1) * step;
      const add = new Map<string, Map<number, number>>();
      for (const r of rows.rows as Raw[]) {
        const m = add.get(String(r.step)) ?? new Map<number, number>();
        m.set(key(r.b), num(r.n));
        add.set(String(r.step), m);
      }
      const unsentAt = new Map<number, number>();
      for (const r of unsent.rows as Raw[]) unsentAt.set(key(r.b), num(r.n));

      const run = { sent: 0, delivered: 0, read: 0, failed: 0, unsent: 0 };
      const upto = (t: number) => {
        for (const [name, m] of add) {
          for (const [b, n] of m) if (b < t) run[name as 'sent' | 'delivered' | 'read' | 'failed'] += n;
        }
        for (const [b, n] of unsentAt) if (b < t) run.unsent += n;
      };
      upto(from);
      const points: ScheduleFunnel['points'] = [];
      for (let t = from; t <= endAt; t += step) {
        for (const [name, m] of add) {
          run[name as 'sent' | 'delivered' | 'read' | 'failed'] += m.get(t) ?? 0;
        }
        run.unsent += unsentAt.get(t) ?? 0;
        points.push({
          at: new Date(t).toISOString(),
          queued: Math.max(0, total - run.sent - run.unsent),
          sent: run.sent,
          delivered: run.delivered,
          read: run.read,
          failed: run.failed,
        });
      }
      return { bucket, total, points };
    });
  }

  /** The recipients of a schedule, filtered by status and a search over the number and the contact's name, a page at a time. */
  async recipients(
    uuid: string,
    q: ListScheduleRecipientsQuery,
  ): Promise<ScheduleRecipientList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const own = await tx.execute(sql`
        SELECT id FROM scheduled_messages WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
      const id = (own.rows[0] as { id: number | string } | undefined)?.id;
      if (id === undefined) throw AppError.notFound('Schedule', uuid);
      const filter = STATUS_FILTER[q.status];
      const needle = q.q?.trim();
      const digits = needle?.replace(/\D+/g, '') ?? '';
      const like = needle ? `%${needle.replace(/[%_\\]/g, '\\$&')}%` : null;
      const search = needle
        ? sql`AND (k.name ILIKE ${like} ${digits.length >= 3 ? sql`OR c.phone LIKE ${`%${digits}%`}` : sql``})`
        : sql``;
      const where = sql`c.org_id = ${orgId} AND c.scheduled_message_id = ${Number(id)} ${filter ? sql`AND ${filter}` : sql``} ${search}`;
      const items = await tx.execute(sql`
        SELECT c.phone, k.name AS contact_name, c.status, c.error_message, c.sent_at, c.delivered_at, c.read_at
          FROM scheduled_message_contacts c LEFT JOIN contacts k ON k.org_id = c.org_id AND k.id = c.contact_id
         WHERE ${where}
         ORDER BY c.id LIMIT ${q.limit} OFFSET ${q.offset}`);
      const total = await tx.execute(sql`
        SELECT count(*)::int AS n
          FROM scheduled_message_contacts c LEFT JOIN contacts k ON k.org_id = c.org_id AND k.id = c.contact_id
         WHERE ${where}`);
      const counts = await tx.execute(sql`
        SELECT status, count(*)::int AS n FROM scheduled_message_contacts
         WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(id)} GROUP BY status`);
      return {
        items: (items.rows as Raw[]).map((p) => ({
          phone: String(p.phone),
          contactName: (p.contact_name as string | null) ?? null,
          status: String(p.status) as ScheduleRecipientList['items'][number]['status'],
          error: (p.error_message as string | null) ?? null,
          sentAt: iso(p.sent_at),
          deliveredAt: iso(p.delivered_at),
          readAt: iso(p.read_at),
        })),
        total: num((total.rows[0] as Raw).n),
        counts: Object.fromEntries((counts.rows as Raw[]).map((c) => [String(c.status), num(c.n)])),
      };
    });
  }
}

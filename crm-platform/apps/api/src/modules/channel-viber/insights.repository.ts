import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface Totals {
  users: number;
  delivered: number;
  seen: number;
  failed: number;
}

/**
 * What this system knows about one channel's traffic, for the insights screen (TW-VIB-016): Viber has no analytics API, so it is
 * computed from the inbox's own messages. Read-only, always inside the caller's tenant transaction.
 */
@Injectable()
export class InsightsRepository {
  /** Messages per day and direction since the first day (in the viewer's zone), keyed `YYYY-MM-DD`. A system line is not a message. */
  async trend(
    tx: Tx,
    orgId: number,
    channelRowId: number,
    tz: string,
    firstDay: string,
  ): Promise<Map<string, { in: number; out: number }>> {
    const res = await tx.execute(sql`
      SELECT to_char(m.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, m.direction, count(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'viber' AND ch.external_id = ${String(channelRowId)}
        AND m.kind <> 'system'
        AND m.created_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}
      GROUP BY 1, 2`);
    const out = new Map<string, { in: number; out: number }>();
    for (const r of res.rows as Array<{ day: string; direction: string; n: number }>) {
      const d = out.get(r.day) ?? { in: 0, out: 0 };
      if (r.direction === 'in') d.in = r.n;
      else d.out = r.n;
      out.set(r.day, d);
    }
    return out;
  }

  /** Active threads (a message from the user in the window) and the receipts on what was sent in the window. */
  async totals(
    tx: Tx,
    orgId: number,
    channelRowId: number,
    tz: string,
    firstDay: string,
  ): Promise<Totals> {
    const users = await tx.execute(sql`
      SELECT count(*)::int AS n
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'viber' AND ch.external_id = ${String(channelRowId)}
        AND c.last_inbound_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}`);
    const receipts = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE m.delivered_at IS NOT NULL)::int AS delivered,
             count(*) FILTER (WHERE m.read_at IS NOT NULL)::int AS seen,
             count(*) FILTER (WHERE m.status = 'failed')::int AS failed
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'viber' AND ch.external_id = ${String(channelRowId)}
        AND m.direction = 'out' AND m.kind <> 'system'
        AND m.created_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}`);
    const r = receipts.rows[0] as { delivered: number; seen: number; failed: number };
    return {
      users: Number((users.rows[0] as { n: number }).n),
      delivered: r.delivered,
      seen: r.seen,
      failed: r.failed,
    };
  }
}

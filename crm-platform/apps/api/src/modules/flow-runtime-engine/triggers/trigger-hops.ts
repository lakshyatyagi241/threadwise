import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import type { OutboxEvent } from '../../../kernel/outbox/outbox-subscribers';

/** The run variable that carries the hop count into the next run (see `FLOW_MAX_TRIGGER_HOPS` in `trigger.service.ts`). */
export const TRIGGER_HOPS_VAR = '__trigger_hops';

/** The most flow starts that may follow one another through events before the next one is refused. */
export const FLOW_MAX_TRIGGER_HOPS = 5;

/**
 * The loop guard's input: an event written while a run's step executed carries that step's request id (`flr-<run>-<seq>`, stamped by
 * the outbox in `_meta`). The event's hop count is the causing run's own count plus one; an event with any other cause is hop 0. The run
 * is read inside the event's tenant, so another workspace's run id can never be read (it simply is not there).
 */
export async function hopsOfEvent(db: DatabaseService, event: OutboxEvent): Promise<number> {
  const meta = event.payload._meta;
  const requestId =
    meta !== null && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).requestId
      : null;
  const m = typeof requestId === 'string' ? /^flr-(\d+)-\d+$/.exec(requestId) : null;
  if (!m) return 0;
  const mine = await db.txAs({ orgId: event.orgId }, async (tx) => {
    const res = (await tx.execute(
      sql`SELECT vars->>${TRIGGER_HOPS_VAR} AS hops FROM flow_runs WHERE org_id = ${event.orgId} AND id = ${Number(m[1])}`,
    )) as unknown as { rows: Array<{ hops: string | null }> };
    return res.rows.length === 0 ? null : Number(res.rows[0]!.hops ?? 0) || 0;
  });
  return mine === null ? 0 : mine + 1;
}

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { DeliveryReport } from '../node-bridge-runtime';

/** A recipient only moves up this ladder; a late report can never undo a later one (WD-NODE-035 rule 7). */
const RANK: Record<string, number> = {
  pending: 0,
  processing: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Applies a delivery report to the scheduled-message recipient it is about (WD-NODE-020, 035). The recipient row carries the
 * provider's message id, so no process memory decides where a report belongs (WaDesk lost the receipts of in-flight schedules
 * on a restart). A read also fills in the delivery time, and the schedule's delivered count moves once per recipient.
 */
@Injectable()
export class ScheduledReceiptsService {
  constructor(private readonly db: DatabaseService) {}

  /** True when the message belongs to a scheduled message, whether or not the report changed anything. */
  async handle(r: DeliveryReport): Promise<boolean> {
    const found = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, scheduled_message_id, status FROM scheduled_message_contacts
         WHERE wa_message_id = ${r.providerMessageId} LIMIT 1`);
      return res.rows[0] as
        | {
            org_id: number | string;
            id: number | string;
            scheduled_message_id: number | string;
            status: string;
          }
        | undefined;
    });
    if (!found) return false;
    const orgId = Number(found.org_id);
    const from = RANK[found.status] ?? 0;
    const to = RANK[r.status] ?? 0;
    if (to <= from) return true;
    const at = r.occurredAt.toISOString();
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const moved = await tx.execute(sql`
        UPDATE scheduled_message_contacts
           SET status = ${r.status},
               delivered_at = coalesce(delivered_at, ${at}::timestamptz),
               read_at = ${r.status === 'read' ? sql`coalesce(read_at, ${at}::timestamptz)` : sql`read_at`}
         WHERE org_id = ${orgId} AND id = ${Number(found.id)} AND status = ${found.status}
        RETURNING id`);
      // Another report won the race: nothing to count.
      if (moved.rows.length === 0 || from >= RANK.delivered!) return;
      await tx.execute(sql`
        UPDATE scheduled_messages SET total_delivered = total_delivered + 1
         WHERE org_id = ${orgId} AND id = ${Number(found.scheduled_message_id)}`);
    });
    return true;
  }
}

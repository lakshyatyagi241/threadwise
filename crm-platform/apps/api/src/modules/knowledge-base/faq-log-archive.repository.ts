import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * The retired FAQ engine's match log (`faq_match_logs`) is kept as an archive until the table is dropped. It holds customers' message
 * text, so the retention sweep keeps running over it; nothing writes or reads it any more.
 */
@Injectable()
export class FaqLogArchiveRepository {
  /** Retention sweep of one batch (privileged). */
  async purgeOlderThan(tx: Tx, days: number, batch: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM faq_match_logs WHERE (org_id, id) IN (
        SELECT org_id, id FROM faq_match_logs WHERE created_at < now() - make_interval(days => ${days}) LIMIT ${batch})
      RETURNING 1`);
    return res.rows.length;
  }
}

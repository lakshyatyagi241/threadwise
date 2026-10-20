import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CappedMap } from '../../common/cache/capped-map';

const BATCH_SIZE = 100;

interface Reservation {
  next: number;
  limit: number;
}

/**
 * Human-facing identifiers — CON-00001, APP-00042, SNAP26-000123.
 *
 * Allocated in batches of 100 and handed out from memory. The naive version
 * (`UPDATE sequence_counters SET current_value = current_value + 1 RETURNING`)
 * takes a row lock per insert, which turns a bulk import of 50k contacts into
 * 50k serialised round-trips on one row.
 *
 * The trade-off is accepted and deliberate: a process restart abandons the
 * rest of its batch, so display ids have gaps. Gaps are fine. A display id is
 * a label, not a count — nothing may infer "how many contacts exist" from it.
 */
@Injectable()
export class DisplayIdService {
  private readonly reservations = new CappedMap<string, Reservation>(5000);

  async next(tx: Tx, orgId: number, moduleKey: string, prefix: string): Promise<string> {
    const cacheKey = `${orgId}:${moduleKey}`;
    let reservation = this.reservations.get(cacheKey);

    if (!reservation || reservation.next > reservation.limit) {
      reservation = await this.reserveBatch(tx, orgId, moduleKey);
      this.reservations.set(cacheKey, reservation);
    }

    const value = reservation.next;
    reservation.next += 1;
    return `${prefix}-${String(value).padStart(5, '0')}`;
  }

  private async reserveBatch(tx: Tx, orgId: number, moduleKey: string): Promise<Reservation> {
    const result = await tx.execute(sql`
      INSERT INTO sequence_counters (org_id, module_key, current_value)
      VALUES (${orgId}, ${moduleKey}, ${BATCH_SIZE})
      ON CONFLICT (org_id, module_key)
      DO UPDATE SET current_value = sequence_counters.current_value + ${BATCH_SIZE}
      RETURNING current_value
    `);

    const end = Number((result.rows[0] as { current_value: number }).current_value);
    return { next: end - BATCH_SIZE + 1, limit: end };
  }

  /** Test hook — drops in-memory reservations so ids restart from the database. */
  reset(): void {
    this.reservations.clear();
  }
}

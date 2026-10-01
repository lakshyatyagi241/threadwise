import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { aggregates, outcome, shouldAdvance, type RecipientCounts } from './recipient-status';

const MODULE_KEY = 'broadcasts';

export interface RecipientUpdate {
  status: string;
  /** Provider error text, cut to 512 characters. */
  error?: string | null;
  providerMessageId?: string | null;
  at?: Date;
}

/**
 * Everything that changes a recipient or the broadcast's progress goes through here (TW-BCAST-025, 026, 027): the sender
 * worker today, the Meta and Twilio status webhooks and Baileys receipts later. One state machine, counters recomputed
 * from the rows so a duplicate report changes nothing.
 */
@Injectable()
export class BroadcastProgressService {
  constructor(private readonly outbox: OutboxService) {}

  /** Moves one recipient forward. False when the state machine refuses (a late or repeated report) or the row is unknown. */
  async applyRecipient(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    contactId: number,
    update: RecipientUpdate,
  ): Promise<boolean> {
    const cur = await tx.execute(sql`
      SELECT status FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId}
      FOR UPDATE`);
    const row = cur.rows[0] as { status: string } | undefined;
    if (!row || !shouldAdvance(row.status, update.status)) return false;

    const at = (update.at ?? new Date()).toISOString();
    await tx.execute(sql`
      UPDATE broadcast_contacts SET
        status = ${update.status},
        error_message = CASE WHEN ${update.error ?? null}::text IS NULL THEN error_message ELSE left(${update.error ?? null}::text, 512) END,
        whatsapp_message_id = coalesce(${update.providerMessageId ?? null}::text, whatsapp_message_id),
        sent_at = CASE WHEN ${update.status} IN ('sent','delivered','read') THEN coalesce(sent_at, ${at}::timestamptz) ELSE sent_at END,
        delivered_at = CASE WHEN ${update.status} IN ('delivered','read') THEN coalesce(delivered_at, ${at}::timestamptz) ELSE delivered_at END,
        read_at = CASE WHEN ${update.status} = 'read' THEN coalesce(read_at, ${at}::timestamptz) ELSE read_at END
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId}`);
    return true;
  }

  async counts(tx: Tx, orgId: number, broadcastId: number): Promise<RecipientCounts> {
    const res = await tx.execute(sql`
      SELECT status, count(*)::int AS n FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} GROUP BY status`);
    const c: RecipientCounts = {
      pending: 0,
      processing: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
    };
    for (const r of res.rows as Array<{ status: string; n: number }>) {
      if (r.status in c) c[r.status as keyof RecipientCounts] += Number(r.n);
    }
    return c;
  }

  /** Rewrites the cached counters from the rows (success includes delivered includes read). `clicked` is not touched. */
  async recompute(tx: Tx, orgId: number, broadcastId: number): Promise<RecipientCounts> {
    const c = await this.counts(tx, orgId, broadcastId);
    const a = aggregates(c);
    await tx.execute(sql`
      UPDATE broadcasts SET success_count = ${a.successCount}, delivered_count = ${a.deliveredCount},
                            read_count = ${a.readCount}, fail_count = ${a.failCount}
      WHERE org_id = ${orgId} AND id = ${broadcastId}`);
    return c;
  }

  /** Sets the terminal status once every recipient is settled; `completed_at` keeps the first terminal time. */
  async finish(tx: Tx, orgId: number, broadcastId: number): Promise<string | null> {
    const c = await this.recompute(tx, orgId, broadcastId);
    const status = outcome(c);
    if (status) await this.setStatus(tx, orgId, broadcastId, status);
    return status;
  }

  async setStatus(tx: Tx, orgId: number, broadcastId: number, status: string): Promise<void> {
    const res = await tx.execute(sql`
      UPDATE broadcasts SET status = ${status},
        completed_at = CASE WHEN ${status} IN ('completed','completed_with_errors','failed')
                            THEN coalesce(completed_at, now()) ELSE completed_at END
      WHERE org_id = ${orgId} AND id = ${broadcastId} AND status IS DISTINCT FROM ${status}
      RETURNING uuid`);
    const row = res.rows[0] as { uuid: string } | undefined;
    if (!row) return;
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: MODULE_KEY,
      aggregateId: broadcastId,
      eventType: 'broadcast.status_changed',
      payload: { uuid: row.uuid, status },
    });
  }
}

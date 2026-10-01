import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { PauseNote } from './pacing';
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
 * Everything that changes a recipient or the broadcast's progress goes through here (WD-BCAST-025, 026, 027): the sender
 * worker today, the Meta and Twilio status webhooks and Baileys receipts later. One state machine, counters recomputed
 * from the rows so a duplicate report changes nothing.
 */
@Injectable()
export class BroadcastProgressService {
  constructor(private readonly outbox: OutboxService) {}

  /** Moves one recipient forward. Returns the status it had before, or null when the state machine refuses (a late or repeated report) or the row is unknown. */
  async applyRecipient(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    contactId: number,
    update: RecipientUpdate,
  ): Promise<string | null> {
    const cur = await tx.execute(sql`
      SELECT status FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId}
      FOR UPDATE`);
    const row = cur.rows[0] as { status: string } | undefined;
    if (!row || !shouldAdvance(row.status, update.status)) return null;

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
    return row.status;
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

  /** Moves the cached counters by one recipient's change of tier; a repeat of the same change is never applied twice. */
  async bumpCounters(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    d: { success: number; delivered: number; read: number; fail: number },
  ): Promise<void> {
    if (d.success === 0 && d.delivered === 0 && d.read === 0 && d.fail === 0) return;
    await tx.execute(sql`
      UPDATE broadcasts SET
        success_count = greatest(0, success_count + ${d.success}),
        delivered_count = greatest(0, delivered_count + ${d.delivered}),
        read_count = greatest(0, read_count + ${d.read}),
        fail_count = greatest(0, fail_count + ${d.fail})
      WHERE org_id = ${orgId} AND id = ${broadcastId}`);
  }

  /** A late failure (or a failure that turned out fine) can change how a finished broadcast ended: derive it again. */
  async refreshOutcome(tx: Tx, orgId: number, broadcastId: number): Promise<void> {
    const res = await tx.execute(
      sql`SELECT status FROM broadcasts WHERE org_id = ${orgId} AND id = ${broadcastId}`,
    );
    const status = (res.rows[0] as { status: string } | undefined)?.status;
    if (status && ['completed', 'completed_with_errors', 'failed'].includes(status)) {
      await this.finish(tx, orgId, broadcastId);
    }
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

  /** Stops a run without losing anyone: the status is `paused` and the reason is kept for the screen and the resumer. */
  async pause(tx: Tx, orgId: number, broadcastId: number, note: PauseNote): Promise<void> {
    await tx.execute(sql`
      UPDATE broadcasts SET messages_log = jsonb_set(coalesce(messages_log, '{}'::jsonb), '{pause}', ${JSON.stringify(note)}::jsonb)
      WHERE org_id = ${orgId} AND id = ${broadcastId}`);
    await this.setStatus(tx, orgId, broadcastId, 'paused');
  }

  /** Back to running: the pause note goes away. The unsent recipients are still `pending`, so the sender picks them up. */
  async resume(tx: Tx, orgId: number, broadcastId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE broadcasts SET messages_log = messages_log - 'pause', node_schedule_id = NULL
      WHERE org_id = ${orgId} AND id = ${broadcastId}`);
    await this.setStatus(tx, orgId, broadcastId, 'processing');
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

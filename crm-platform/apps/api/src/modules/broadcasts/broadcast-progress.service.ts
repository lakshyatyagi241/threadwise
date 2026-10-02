import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { WalletDeliveryStatus } from '@crm/contracts';
import { deliveryProviderOf, emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { PauseNote } from './pacing';
import { assemblePhone } from './recipient-phone';
import { aggregates, outcome, shouldAdvance, type RecipientCounts } from './recipient-status';
import {
  createdNotification,
  createdWebhook,
  MESSAGE_EVENTS,
  messageWebhooks,
  statusNotification,
  statusWebhook,
  type BroadcastSnapshot,
  type MessageStatus,
} from './webhook-events';

const MODULE_KEY = 'broadcasts';
const DELIVERY_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

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
      SELECT status, whatsapp_message_id FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId}
      FOR UPDATE`);
    const row = cur.rows[0] as { status: string; whatsapp_message_id: string | null } | undefined;
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

    // The wallet learns of a real transition only (a repeat of the same status is not news), in this transaction.
    const providerMessageId = update.providerMessageId ?? row.whatsapp_message_id;
    if (providerMessageId && row.status !== update.status && DELIVERY_STATUSES.has(update.status)) {
      await this.reportDelivery(
        tx,
        orgId,
        broadcastId,
        contactId,
        providerMessageId,
        update.status as WalletDeliveryStatus,
      );
    }
    return row.status;
  }

  /** `message.delivery_reported` for the wallet (WD-WALLET-012): the broadcast's engine, the template's category, the recipient's number. */
  private async reportDelivery(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    contactId: number,
    providerMessageId: string,
    status: WalletDeliveryStatus,
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT b.provider, coalesce(t.meta_category, t.category) AS category, c.phone, c.country_code
      FROM broadcasts b
      JOIN contacts c ON c.org_id = b.org_id AND c.id = ${contactId}
      LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
      WHERE b.org_id = ${orgId} AND b.id = ${broadcastId}`);
    const r = res.rows[0] as
      | {
          provider: string | null;
          category: string | null;
          phone: string | null;
          country_code: string | null;
        }
      | undefined;
    if (!r) return;
    // A broadcast without an engine sends through the unofficial one (the dispatcher's own default).
    const provider = deliveryProviderOf(r.provider ?? 'baileys');
    if (!provider) return;
    await emitDeliveryReported(this.outbox, tx, {
      orgId,
      aggregateModule: MODULE_KEY,
      aggregateId: broadcastId,
      report: {
        provider,
        providerMessageId,
        status,
        recipient: assemblePhone(r.phone, r.country_code) || null,
        category: r.category,
        source: 'broadcast',
      },
    });
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

  /** The broadcast as the outside world sees it: name, template and the cached counters. Null when the row is gone. */
  async snapshot(tx: Tx, orgId: number, broadcastId: number): Promise<BroadcastSnapshot | null> {
    const res = await tx.execute(sql`
      SELECT b.uuid, b.name, t.uuid AS template_uuid, b.status, b.total_recipients, b.success_count,
             b.delivered_count, b.read_count, b.fail_count, b.clicked_count
      FROM broadcasts b
      LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
      WHERE b.org_id = ${orgId} AND b.id = ${broadcastId}`);
    const r = res.rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      uuid: r.uuid as string,
      name: r.name as string,
      templateUuid: (r.template_uuid as string | null) ?? null,
      status: r.status as string,
      totalRecipients: Number(r.total_recipients),
      successCount: Number(r.success_count),
      deliveredCount: Number(r.delivered_count),
      readCount: Number(r.read_count),
      failCount: Number(r.fail_count),
      clickedCount: Number(r.clicked_count),
    };
  }

  /** True when the org has an active webhook subscribed to one of these events (or to `*`): per-message events are only written then. */
  async hasSubscriber(tx: Tx, orgId: number, events: readonly string[]): Promise<boolean> {
    const names = sql.join(
      [...events, '*'].map((e) => sql`${e}`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT 1 FROM webhooks WHERE org_id = ${orgId} AND status AND events ?| ARRAY[${names}]::text[] LIMIT 1`);
    return res.rows.length > 0;
  }

  /**
   * One recipient's message as outbound webhook events (`message_*`, plus `broadcast_message_status_updated` for provider
   * receipts). Not every message goes through the outbox: at campaign volume that would drown it, so nothing is written
   * unless a customer webhook is listening. Call after the counters moved so the aggregate block is current.
   */
  async emitMessage(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    contactId: number,
    status: string,
    source: 'send' | 'receipt',
    detail: {
      providerMessageId?: string | null;
      errorCode?: string | null;
      errorReason?: string | null;
      at?: Date;
    } = {},
  ): Promise<void> {
    if (!(status in MESSAGE_EVENTS)) return;
    const tier = status as MessageStatus;
    const wanted = [
      MESSAGE_EVENTS[tier],
      ...(source === 'receipt' ? ['broadcast_message_status_updated'] : []),
    ];
    if (!(await this.hasSubscriber(tx, orgId, wanted))) return;

    const b = await this.snapshot(tx, orgId, broadcastId);
    if (!b) return;
    // The worker recomputes the cached counters in batches; the aggregate block must be exact now.
    const live = aggregates(await this.counts(tx, orgId, broadcastId));
    const exact = {
      ...b,
      successCount: live.successCount,
      deliveredCount: live.deliveredCount,
      readCount: live.readCount,
      failCount: live.failCount,
    };
    const who = await tx.execute(sql`
      SELECT c.uuid, c.phone, bc.whatsapp_message_id
      FROM broadcast_contacts bc JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
      WHERE bc.org_id = ${orgId} AND bc.broadcast_id = ${broadcastId} AND bc.contact_id = ${contactId}`);
    const c = who.rows[0] as
      { uuid: string; phone: string | null; whatsapp_message_id: string | null } | undefined;
    if (!c) return;

    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: MODULE_KEY,
      aggregateId: broadcastId,
      eventType: 'broadcast.message_status',
      payload: {
        uuid: b.uuid,
        status,
        webhook: messageWebhooks(
          exact,
          {
            status: tier,
            contactUuid: c.uuid,
            phone: c.phone,
            providerMessageId: detail.providerMessageId ?? c.whatsapp_message_id,
            errorCode: detail.errorCode,
            errorReason: detail.errorReason,
            at: detail.at ?? new Date(),
          },
          source,
        ),
      },
    });
  }

  async setStatus(tx: Tx, orgId: number, broadcastId: number, status: string): Promise<void> {
    const prev = await tx.execute(
      sql`SELECT status FROM broadcasts WHERE org_id = ${orgId} AND id = ${broadcastId} FOR UPDATE`,
    );
    const previous = (prev.rows[0] as { status: string } | undefined)?.status ?? null;
    const res = await tx.execute(sql`
      UPDATE broadcasts SET status = ${status},
        completed_at = CASE WHEN ${status} IN ('completed','completed_with_errors','failed')
                            THEN coalesce(completed_at, now()) ELSE completed_at END
      WHERE org_id = ${orgId} AND id = ${broadcastId} AND status IS DISTINCT FROM ${status}
      RETURNING uuid`);
    const row = res.rows[0] as { uuid: string } | undefined;
    if (!row) return;
    const b = await this.snapshot(tx, orgId, broadcastId);
    const note = b ? statusNotification(b) : null;
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: MODULE_KEY,
      aggregateId: broadcastId,
      eventType: 'broadcast.status_changed',
      payload: {
        uuid: row.uuid,
        status,
        previousStatus: previous,
        webhook: b ? statusWebhook(b, previous, new Date()) : [],
        ...(note ? { notification: note } : {}),
      },
    });
  }

  /** The `broadcast.created` payload for a broadcast that was just inserted. */
  async createdPayload(
    tx: Tx,
    orgId: number,
    broadcastId: number,
  ): Promise<Record<string, unknown>> {
    const b = await this.snapshot(tx, orgId, broadcastId);
    return b
      ? { webhook: createdWebhook(b, new Date()), notification: createdNotification(b) }
      : {};
  }
}

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { WalletDeliveryStatus } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { deliveryProviderOf, emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  counterDelta,
  effectiveCategory,
  failureText,
  shouldAdvance,
  type DeliveryReceipt,
} from '../broadcasts';
import type { DeliveryReport } from '../node-bridge-runtime';

/** One report about a scheduled message's recipient, from any source, already in our terms. */
interface Report {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: Date;
  errorMessage?: string | null;
  errorCode?: string | null;
}

interface Found {
  org_id: number | string;
  id: number | string;
  scheduled_message_id: number | string;
  status: string;
}

/**
 * Applies a provider's delivery report to the scheduled-message recipient it is about (TW-SCHED-024, TW-NODE-020, 035). The recipient
 * row carries the provider's message id, so no process memory decides where a report belongs (Reference lost the receipts of in-flight
 * schedules on a restart).
 *
 * Two doors, one state machine: the unofficial engine's acks arrive with the workspace of the device that reported them
 * (`handle`); a Cloud API status arrives with a message id and nothing else, and a narrow lookup function names the workspace
 * (`handleReceipt`), after which everything runs under that workspace.
 *
 * The machine is the broadcast sender's: a recipient only moves forward, `failed` is final and also follows a sent or delivered message
 * (a provider may report a message failed after accepting it), `read` ignores anything later, and the same report twice changes
 * nothing. A real transition writes the wallet event in the same transaction: a delivery charges, a failure refunds what was charged.
 */
@Injectable()
export class ScheduledReceiptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  /** The unofficial engine's report. True when the message belongs to a scheduled message, whether or not the report changed anything. */
  async handle(r: DeliveryReport): Promise<boolean> {
    // The report names the workspace of the device that sent it, so the lookup runs in that workspace (RLS on) and is also filtered by
    // org_id: a provider message id that happened to exist in another workspace is never claimed from here (TI-014).
    const found = await this.db.txAs({ orgId: r.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, scheduled_message_id, status FROM scheduled_message_contacts
         WHERE org_id = ${r.orgId} AND wa_message_id = ${r.providerMessageId} LIMIT 1`);
      return res.rows[0] as unknown as Found | undefined;
    });
    if (!found) return false;
    await this.apply(found, r);
    return true;
  }

  /** The Cloud API's (and any other provider-webhook) report. False for a message that is not a scheduled message's. */
  async handleReceipt(receipt: DeliveryReceipt): Promise<boolean> {
    if (!receipt.providerMessageId) return false;
    const hit = await this.db.primary.execute(
      sql`SELECT * FROM sched_receipt_lookup(${receipt.providerMessageId})`,
    );
    const row = hit.rows[0] as
      { receipt_org_id: number | string; receipt_recipient_id: number | string } | undefined;
    if (!row) return false;
    const orgId = Number(row.receipt_org_id);
    const found = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, scheduled_message_id, status FROM scheduled_message_contacts
         WHERE org_id = ${orgId} AND id = ${Number(row.receipt_recipient_id)}`);
      return res.rows[0] as unknown as Found | undefined;
    });
    if (!found) return false;
    await this.apply(found, receipt);
    return true;
  }

  private async apply(found: Found, report: Report | DeliveryReport): Promise<void> {
    const orgId = Number(found.org_id);
    const at = report.occurredAt.toISOString();
    const failed = report.status === 'failed';
    const error = failed
      ? failureText((report as Report).errorMessage, (report as Report).errorCode)
      : null;
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      // The row is locked while it moves, so two reports of one message are applied one after the other, each seeing the other's result.
      const cur = await tx.execute(sql`
        SELECT status FROM scheduled_message_contacts
         WHERE org_id = ${orgId} AND id = ${Number(found.id)} FOR UPDATE`);
      const from = (cur.rows[0] as { status: string } | undefined)?.status;
      if (!from || from === report.status || !shouldAdvance(from, report.status)) return;
      await tx.execute(sql`
        UPDATE scheduled_message_contacts
           SET status = ${report.status},
               sent_at = CASE WHEN ${report.status} IN ('sent', 'delivered', 'read') THEN coalesce(sent_at, ${at}::timestamptz) ELSE sent_at END,
               delivered_at = CASE WHEN ${report.status} IN ('delivered', 'read') THEN coalesce(delivered_at, ${at}::timestamptz) ELSE delivered_at END,
               read_at = CASE WHEN ${report.status} = 'read' THEN coalesce(read_at, ${at}::timestamptz) ELSE read_at END,
               failed_at = CASE WHEN ${failed} THEN ${at}::timestamptz ELSE failed_at END,
               error_message = CASE WHEN ${failed} THEN ${error} ELSE error_message END
         WHERE org_id = ${orgId} AND id = ${Number(found.id)}`);
      // Delivered moves the schedule's delivered count once per recipient; a failure after a send counts as failed. The sent count is
      // what the run handed to the provider and does not go back down.
      const d = counterDelta(from, report.status);
      if (d.delivered !== 0 || d.fail !== 0) {
        await tx.execute(sql`
          UPDATE scheduled_messages
             SET total_delivered = greatest(0, total_delivered + ${d.delivered}),
                 total_failed = greatest(0, total_failed + ${d.fail})
           WHERE org_id = ${orgId} AND id = ${Number(found.scheduled_message_id)}`);
      }
      await this.reportToWallet(
        tx,
        orgId,
        Number(found.scheduled_message_id),
        Number(found.id),
        report.providerMessageId,
        report.status,
      );
    });
  }

  /** `message.delivery_reported` for the wallet (TW-WALLET-012): the schedule's engine, its template's category, the recipient's number. */
  private async reportToWallet(
    tx: Tx,
    orgId: number,
    scheduledId: number,
    recipientId: number,
    providerMessageId: string,
    status: WalletDeliveryStatus,
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT m.provider, t.category, t.meta_category, c.phone
        FROM scheduled_message_contacts c
        JOIN scheduled_messages m ON m.org_id = c.org_id AND m.id = c.scheduled_message_id
        LEFT JOIN wa_templates t ON t.org_id = m.org_id AND t.id = m.template_id
       WHERE c.org_id = ${orgId} AND c.id = ${recipientId}`);
    const r = res.rows[0] as
      | {
          provider: string | null;
          category: string | null;
          meta_category: string | null;
          phone: string | null;
        }
      | undefined;
    if (!r) return;
    // A schedule without an engine sends through the unofficial one (the runner's own default).
    const provider = deliveryProviderOf(r.provider ?? 'baileys');
    if (!provider) return;
    await emitDeliveryReported(this.outbox, tx, {
      orgId,
      aggregateModule: 'scheduled_messages',
      aggregateId: scheduledId,
      report: {
        provider,
        providerMessageId,
        status,
        recipient: (r.phone ?? '').replace(/\D+/g, '') || null,
        category:
          r.category || r.meta_category ? effectiveCategory(r.meta_category, r.category) : null,
        source: 'scheduled',
      },
    });
  }
}

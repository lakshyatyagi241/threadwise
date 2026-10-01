import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { counterDelta, failureText } from './receipt-rules';

/** One delivery report about a message, from any provider, already in our terms. */
export interface DeliveryReceipt {
  /** The id the provider gave the message when it was sent (a Cloud API wamid, a Twilio SID). */
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: Date;
  errorMessage?: string | null;
  errorCode?: string | null;
}

/**
 * Applies a delivery receipt to the broadcast recipient it is about (WD-BCAST-024, 027).
 *
 * Called by whatever receives the report: the Cloud API webhook handler, the Twilio status callback, the Baileys adapter.
 * The caller has already checked who is speaking (the webhook signature, the callback token); this only decides what the
 * report changes. It needs no tenant: the recipient row carries the provider's message id, and a narrow lookup function
 * (migration 20261002110400) names the tenant, after which the receipt is applied under the normal tenant context.
 *
 * One state machine for every source: a recipient only moves forward, `failed` is final, `read` ignores a late delivered, and
 * the same receipt twice changes nothing. The broadcast's counters move by the recipient's change, not by a recount.
 */
@Injectable()
export class BroadcastReceiptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly progress: BroadcastProgressService,
  ) {}

  /** True when the message belongs to a broadcast (whether or not the receipt changed anything); false for any other message. */
  async handle(receipt: DeliveryReceipt): Promise<boolean> {
    if (!receipt.providerMessageId) return false;
    const found = await this.db.primary.execute(
      sql`SELECT * FROM bcast_receipt_lookup(${receipt.providerMessageId})`,
    );
    const hit = found.rows[0] as
      | {
          receipt_org_id: number | string;
          receipt_broadcast_id: number | string;
          receipt_contact_id: number | string;
        }
      | undefined;
    if (!hit) return false;

    const orgId = Number(hit.receipt_org_id);
    const broadcastId = Number(hit.receipt_broadcast_id);
    const contactId = Number(hit.receipt_contact_id);

    await this.db.txAs({ orgId }, async (tx) => {
      const from = await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
        status: receipt.status,
        error:
          receipt.status === 'failed'
            ? failureText(receipt.errorMessage, receipt.errorCode)
            : undefined,
        at: receipt.occurredAt,
      });
      if (from === null) return; // late, repeated or not allowed: nothing moves
      await this.progress.bumpCounters(tx, orgId, broadcastId, counterDelta(from, receipt.status));
      if (receipt.status === 'failed' || from === 'failed')
        await this.progress.refreshOutcome(tx, orgId, broadcastId);
      // A repeat of the same status is accepted but is not news: no event.
      if (from !== receipt.status)
        await this.progress.emitMessage(
          tx,
          orgId,
          broadcastId,
          contactId,
          receipt.status,
          'receipt',
          {
            providerMessageId: receipt.providerMessageId,
            errorCode: receipt.errorCode ?? null,
            errorReason:
              receipt.status === 'failed'
                ? failureText(receipt.errorMessage, receipt.errorCode)
                : null,
            at: receipt.occurredAt,
          },
        );
    });
    return true;
  }

  async handleMany(receipts: readonly DeliveryReceipt[]): Promise<number> {
    let belonged = 0;
    for (const r of receipts) if (await this.handle(r)) belonged++;
    return belonged;
  }
}

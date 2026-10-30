import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { DeliveryReceipt } from '../broadcasts';
import { CampaignEvents, asSystem } from './campaign-events';
import { CampaignMirrorService } from './campaign-mirror.service';
import { isNewer } from './campaign-rules';
import { followUpStatusIsNewer } from './wizard/wizard-follow-up-rules';
import { CampaignsRepository } from './campaigns.repository';

/** The shortest time between two roll-ups of one campaign's counters from delivery receipts. */
const RECOUNT_EVERY_MS = 1_000;
/** The trailing roll-up never fires sooner than this after the receipt that armed it. */
const TRAILING_MIN_MS = 500;

/**
 * Applies a delivery report to the campaign recipient it is about (TW-CAMP-021). One state machine for every source (the Cloud
 * API webhook, the Twilio callback, the Baileys adapter, the Node bridge): a recipient only moves forward, `read` never goes back to
 * `delivered`, a repeat changes nothing, and each time is set once. The caller has proved who is speaking; the message id names
 * the tenant through a narrow lookup function, after which the report is applied under the normal tenant context.
 */
@Injectable()
export class CampaignReceiptsService {
  private readonly logger = new Logger(CampaignReceiptsService.name);
  /** When each campaign's counters were last rolled up by this process, and the trailing roll-up waiting for a quiet moment. */
  private readonly lastRecount = new Map<number, number>();
  private readonly trailing = new Set<number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly events: CampaignEvents,
    private readonly mirror: CampaignMirrorService,
  ) {}

  /**
   * True when the message belongs to a campaign, whether or not the report changed anything; false for any other message, so the
   * caller can offer it to broadcasts next.
   */
  async handle(receipt: DeliveryReceipt): Promise<boolean> {
    if (!receipt.providerMessageId) return false;
    const found = await this.db.primary.execute(
      sql`SELECT * FROM camp_receipt_lookup(${receipt.providerMessageId})`,
    );
    const hit = found.rows[0] as
      | {
          receipt_org_id: number | string;
          receipt_campaign_id: number | string;
          receipt_contact_id: number | string;
        }
      | undefined;
    if (!hit) return this.handleFollowUp(receipt);
    const orgId = Number(hit.receipt_org_id);
    const campaignId = Number(hit.receipt_campaign_id);
    const contactId = Number(hit.receipt_contact_id);

    const moved = await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        const row = await this.repo.recipientOf(tx, orgId, campaignId, contactId);
        if (!row || !isNewer(row.status, receipt.status)) return false;
        const at = receipt.occurredAt;
        await this.repo.applyReport(tx, orgId, row.id, {
          status: receipt.status,
          error:
            receipt.status === 'failed'
              ? (receipt.errorMessage ?? '').trim() ||
                (receipt.errorCode ? `error_code:${receipt.errorCode}` : null)
              : null,
          errorCode: receipt.status === 'failed' ? (receipt.errorCode ?? null) : null,
          sentAt: receipt.status === 'sent' ? at : null,
          deliveredAt: receipt.status === 'delivered' ? at : null,
          readAt: receipt.status === 'read' ? at : null,
        });
        // Only the id and name are needed; the full campaign read aggregates every recipient, on every receipt.
        const c = await this.repo.identityOf(tx, orgId, campaignId);
        // A repeat of the same status is accepted but is not news: no event.
        if (c && row.status !== receipt.status) {
          await this.events.deliveryReported(
            tx,
            orgId,
            campaignId,
            contactId,
            row.status,
            receipt.status,
            receipt.providerMessageId,
          );
          await this.events.contactStatus(
            tx,
            campaignId,
            c.uuid,
            c.name,
            contactId,
            receipt.status,
            {
              providerMessageId: receipt.providerMessageId,
              error: receipt.status === 'failed' ? receipt.errorMessage : null,
            },
          );
        }
        await this.recountSoon(tx, orgId, campaignId);
        return true;
      }),
    );
    if (moved && receipt.status !== 'failed') {
      await this.mirror.mirror(
        orgId,
        campaignId,
        contactId,
        receipt.status,
        receipt.providerMessageId,
      );
    }
    return true;
  }

  /**
   * Rolls the recipient rows up into the campaign's counters, at most once a second per campaign. The roll-up reads every recipient
   * and writes the one campaign row, so doing it for each of the three receipts of every message makes a send cost more the bigger it
   * is and lines every receipt up behind that row. A receipt inside the second leaves one trailing roll-up so the last counts land.
   * shortcut: the debounce lives in this process; counters read by a screen are rolled up again on read (campaigns-read), so a restart
   * only delays them by that read.
   */
  private async recountSoon(tx: Tx, orgId: number, campaignId: number): Promise<void> {
    const now = Date.now();
    if (this.lastRecount.size > 1_000) {
      for (const [id, at] of this.lastRecount) if (now - at > 60_000) this.lastRecount.delete(id);
    }
    const last = this.lastRecount.get(campaignId) ?? 0;
    if (now - last >= RECOUNT_EVERY_MS) {
      this.lastRecount.set(campaignId, now);
      await this.repo.recount(tx, orgId, campaignId);
      return;
    }
    if (this.trailing.has(campaignId)) return;
    this.trailing.add(campaignId);
    setTimeout(
      () => {
        this.trailing.delete(campaignId);
        this.lastRecount.set(campaignId, Date.now());
        asSystem(orgId, () =>
          this.db.txAs({ orgId }, (t) => this.repo.recount(t, orgId, campaignId)),
        ).catch((err) =>
          this.logger.warn(
            { orgId, campaignId, err: String(err) },
            '[CAMP] trailing roll-up failed',
          ),
        );
      },
      // The receipt that armed this is still inside its transaction: wait long enough for it to commit so the roll-up sees it.
      Math.max(RECOUNT_EVERY_MS - (now - last), TRAILING_MIN_MS),
    ).unref();
  }

  /**
   * A delivery report about the message of a follow-up step (not the campaign message itself): it is recorded on the step's log row
   * (its own delivery and read, which later steps look at) and reported to the wallet, which charges the message once it is delivered.
   */
  private async handleFollowUp(receipt: DeliveryReceipt): Promise<boolean> {
    const found = await this.db.primary.execute(
      sql`SELECT * FROM camp_follow_up_receipt_lookup(${receipt.providerMessageId})`,
    );
    const hit = found.rows[0] as
      | {
          receipt_org_id: number | string;
          receipt_campaign_id: number | string;
          receipt_contact_id: number | string;
          receipt_attempt_id: number | string;
        }
      | undefined;
    if (!hit) return false;
    const orgId = Number(hit.receipt_org_id);
    const campaignId = Number(hit.receipt_campaign_id);
    const contactId = Number(hit.receipt_contact_id);
    const attemptId = Number(hit.receipt_attempt_id);
    await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        const row = (
          await tx.execute(
            sql`SELECT delivery_status FROM camp_follow_up_attempts WHERE org_id = ${orgId} AND id = ${attemptId} FOR UPDATE`,
          )
        ).rows[0] as { delivery_status: string | null } | undefined;
        if (!row || !followUpStatusIsNewer(row.delivery_status, receipt.status)) return;
        const at = receipt.occurredAt.toISOString();
        await tx.execute(sql`
          UPDATE camp_follow_up_attempts SET delivery_status = ${receipt.status},
            delivered_at = CASE WHEN ${receipt.status} = 'delivered' THEN coalesce(delivered_at, ${at}::timestamptz) ELSE delivered_at END,
            read_at = CASE WHEN ${receipt.status} = 'read' THEN coalesce(read_at, ${at}::timestamptz) ELSE read_at END,
            error_code = CASE WHEN ${receipt.status} = 'failed' THEN coalesce(${receipt.errorCode ?? null}, error_code) ELSE error_code END,
            error_message = CASE WHEN ${receipt.status} = 'failed' THEN coalesce(${(receipt.errorMessage ?? '').trim().slice(0, 1024) || null}, error_message) ELSE error_message END
          WHERE org_id = ${orgId} AND id = ${attemptId}`);
        await this.events.deliveryReported(
          tx,
          orgId,
          campaignId,
          contactId,
          row.delivery_status ?? 'queued',
          receipt.status,
          receipt.providerMessageId,
        );
      }),
    );
    return true;
  }
}

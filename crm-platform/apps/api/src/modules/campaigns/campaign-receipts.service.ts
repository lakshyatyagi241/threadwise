import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { DeliveryReceipt } from '../broadcasts';
import { CampaignEvents, asSystem } from './campaign-events';
import { CampaignMirrorService } from './campaign-mirror.service';
import { isNewer } from './campaign-rules';
import { followUpStatusIsNewer } from './wizard/wizard-follow-up-rules';
import { CampaignsRepository } from './campaigns.repository';

/**
 * Applies a delivery report to the campaign recipient it is about (TW-CAMP-021). One state machine for every source (the Cloud
 * API webhook, the Twilio callback, the Baileys adapter, the Node bridge): a recipient only moves forward, `read` never goes back to
 * `delivered`, a repeat changes nothing, and each time is set once. The caller has proved who is speaking; the message id names
 * the tenant through a narrow lookup function, after which the report is applied under the normal tenant context.
 */
@Injectable()
export class CampaignReceiptsService {
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
        const c = await this.repo.findById(tx, orgId, campaignId);
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
        await this.repo.recount(tx, orgId, campaignId);
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

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { DeliveryReceipt } from '../broadcasts';
import { CampaignEvents, asSystem } from './campaign-events';
import { CampaignMirrorService } from './campaign-mirror.service';
import { isNewer } from './campaign-rules';
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
    if (!hit) return false;
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
}

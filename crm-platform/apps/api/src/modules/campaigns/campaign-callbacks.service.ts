import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { CAMPAIGN_BILLING, type CampaignBilling } from './_shims/tokens';
import { CampaignEvents, asSystem } from './campaign-events';
import { CampaignMirrorService } from './campaign-mirror.service';
import { CampaignsRepository } from './campaigns.repository';

const digitsOf = (v: string) => v.replace(/\D+/g, '');

export type ContactStatus =
  'queued' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unsubscribed';

/**
 * What the Node bridge tells us about a campaign (WD-CAMP-021, 022). The caller has already proved who it is (the bridge token);
 * these only decide what the report changes. A campaign is named by its uuid, which a narrow lookup function turns into its
 * organization (the bridge has no tenant), after which everything runs under the normal tenant context. The recipient rows are the
 * truth: every report ends with the counters recomputed from them, so a dropped or repeated report cannot make them drift.
 */
@Injectable()
export class CampaignCallbacksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly events: CampaignEvents,
    private readonly mirror: CampaignMirrorService,
    @Inject(CAMPAIGN_BILLING) private readonly billing: CampaignBilling,
  ) {}

  /** A transaction for one tenant, run as the system: a report has no user, and the outbox takes its tenant from the context. */
  private tenant<T>(
    orgId: number,
    fn: Parameters<DatabaseService['txAs']>[1] & ((tx: never) => Promise<T>),
  ): Promise<T> {
    return asSystem(orgId, () => this.db.txAs({ orgId }, fn as never) as Promise<T>);
  }

  /** The campaign's tenant, or null when it does not exist. */
  private async locate(campaign: string): Promise<{ orgId: number; id: number } | null> {
    const res = await this.db.primary.execute(
      sql`SELECT * FROM camp_campaign_lookup(${campaign}::uuid)`,
    );
    const r = res.rows[0] as
      { campaign_org_id: number | string; campaign_id: number | string } | undefined;
    return r ? { orgId: Number(r.campaign_org_id), id: Number(r.campaign_id) } : null;
  }

  /** Final stats of a run: recount from the rows, then take the status the bridge reports. False when the campaign is unknown. */
  async campaignStatus(input: { campaignId: string; status?: string | null }): Promise<boolean> {
    const at = await this.locate(input.campaignId);
    if (!at) return false;
    await this.tenant(at.orgId, async (tx) => {
      const before = await this.repo.liveStatus(tx, at.orgId, at.id);
      await this.repo.recount(tx, at.orgId, at.id);
      if (input.status) {
        await this.repo.setStatus(tx, at.orgId, at.id, input.status);
        if (before !== input.status)
          await this.events.statusChanged(tx, at.orgId, at.id, before ?? '');
      }
    });
    return true;
  }

  /** One recipient's status, written as reported. False when the campaign is unknown. */
  async contactStatus(input: {
    campaignId: string;
    contactId: string;
    status: ContactStatus;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    variant?: string | null;
    sentAt?: Date | null;
    deliveredAt?: Date | null;
    readAt?: Date | null;
  }): Promise<boolean> {
    const at = await this.locate(input.campaignId);
    if (!at) return false;
    const { orgId } = at;
    const mirrored = await this.tenant(orgId, async (tx) => {
      const [contactId] = await this.repo.contactIdsByUuid(tx, orgId, [input.contactId]);
      if (contactId === undefined) return null;
      const row = await this.repo.recipientOf(tx, orgId, at.id, contactId);
      if (!row) return null;
      await this.repo.applyReport(tx, orgId, row.id, {
        status: input.status,
        error: input.errorMessage,
        providerMessageId: input.providerMessageId,
        variant: input.variant,
        sentAt: input.sentAt,
        deliveredAt: input.deliveredAt,
        readAt: input.readAt,
      });
      const c = await this.repo.findById(tx, orgId, at.id);
      if (c) {
        await this.events.contactStatus(tx, at.id, c.uuid, c.name, contactId, input.status, {
          providerMessageId: input.providerMessageId,
          error: input.errorMessage,
        });
      }
      // Billing: charge on delivery, refund on failure, idempotent per message id.
      if (input.providerMessageId) {
        if (['sent', 'delivered', 'read'].includes(input.status)) {
          await this.billing.settleDelivered(
            orgId,
            input.providerMessageId,
            await this.repo.contactPhone(tx, orgId, contactId),
          );
        } else if (input.status === 'failed') {
          await this.billing.settleFailed(orgId, input.providerMessageId);
        }
      }
      await this.repo.recount(tx, orgId, at.id);
      return { contactId };
    });
    // After the report is committed, and never failing it: the inbox bubble is best effort.
    if (mirrored && ['sent', 'delivered', 'read'].includes(input.status)) {
      await this.mirror.mirror(
        orgId,
        at.id,
        mirrored.contactId,
        input.status,
        input.providerMessageId ?? null,
      );
    }
    return mirrored !== null;
  }

  /** A recipient replied. Stores the response and the time and emits `campaign.contact_replied`. */
  async trackResponse(input: {
    campaignId: string;
    contactId: string;
    response?: string | null;
    respondedAt?: Date | null;
  }): Promise<boolean> {
    const at = await this.locate(input.campaignId);
    if (!at) return false;
    await this.tenant(at.orgId, async (tx) => {
      const [contactId] = await this.repo.contactIdsByUuid(tx, at.orgId, [input.contactId]);
      if (contactId === undefined) return;
      const response = (input.response ?? '').slice(0, 4096);
      await this.repo.setResponse(
        tx,
        at.orgId,
        at.id,
        contactId,
        response,
        input.respondedAt ?? new Date(),
      );
      const c = await this.repo.findById(tx, at.orgId, at.id);
      if (c) await this.events.replied(tx, at.id, c.uuid, c.name, contactId, response);
      await this.repo.recount(tx, at.orgId, at.id);
    });
    return true;
  }

  /**
   * A STOP keyword was detected in a reply. The recipient's row is stamped, the contact is opted out for every campaign and
   * broadcast, and `contact.opt_in` (opted_in false) is emitted only when the contact really changed.
   */
  async unsubscribe(input: { campaignId: string; phone: string }): Promise<boolean> {
    const at = await this.locate(input.campaignId);
    if (!at) return false;
    const digits = digitsOf(input.phone);
    await this.tenant(at.orgId, async (tx) => {
      const contact = await this.repo.contactByPhone(tx, at.orgId, digits);
      const row = await this.repo.unsubscribeRow(tx, at.orgId, at.id, contact?.id ?? null, digits);
      if (!row) return;
      await this.repo.markUnsubscribed(tx, at.orgId, row.id);
      if (row.contactId !== null) {
        const changed = await this.repo.optOutContact(tx, at.orgId, row.contactId);
        if (changed) {
          await this.events.optedOut(
            tx,
            at.id,
            row.contactId,
            await this.repo.contactPhone(tx, at.orgId, row.contactId),
          );
        }
      }
      await this.repo.recount(tx, at.orgId, at.id);
    });
    return true;
  }
}

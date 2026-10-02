import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MODULE_KEY } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';

/**
 * The events a campaign emits (WD-CAMP-024), through the outbox in the same transaction as the change they describe. WaDesk fired
 * them from the model so every status write was covered; here every writer calls these, so none is missed. Names follow the
 * outbox convention (`campaign.status_updated`); the outbound webhook maps them to WaDesk's `campaign_status_updated` and so on.
 */
@Injectable()
export class CampaignEvents {
  constructor(
    private readonly repo: CampaignsRepository,
    private readonly outbox: OutboxService,
  ) {}

  /** After any status change: the campaign as it is now, its counts, and the status it left. */
  async statusChanged(tx: Tx, orgId: number, campaignId: number, previous: string): Promise<void> {
    const c = await this.repo.findById(tx, orgId, campaignId);
    if (!c) return;
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: campaignId,
      eventType: 'campaign.status_updated',
      payload: {
        uuid: c.uuid,
        name: c.name,
        status: c.status,
        previousStatus: previous,
        totalRecipients: c.totalRecipients,
        sent: c.counts.sent,
        delivered: c.counts.delivered,
        read: c.counts.read,
        failed: c.counts.failed,
        replies: c.counts.responded,
      },
    });
  }

  async contactStatus(
    tx: Tx,
    campaignId: number,
    campaignUuid: string,
    campaignName: string,
    contactId: number,
    status: string,
    o: { providerMessageId?: string | null; error?: string | null } = {},
  ): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: campaignId,
      eventType: 'campaign.contact_status_updated',
      payload: {
        uuid: campaignUuid,
        name: campaignName,
        contactId,
        status,
        providerMessageId: o.providerMessageId ?? null,
        error: o.error ?? null,
      },
    });
  }

  async replied(
    tx: Tx,
    campaignId: number,
    campaignUuid: string,
    campaignName: string,
    contactId: number,
    response: string,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: campaignId,
      eventType: 'campaign.contact_replied',
      payload: { uuid: campaignUuid, name: campaignName, contactId, response },
    });
  }

  /** An opt-out through a STOP keyword: `contact.opt_in` with `optedIn: false`, only on a real change. */
  async optedOut(
    tx: Tx,
    campaignId: number,
    contactId: number,
    phone: string | null,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: campaignId,
      eventType: 'contact.opt_in',
      payload: { contactId, phone, optedIn: false, action: 'unsubscribed', source: 'stop_keyword' },
    });
  }
}

/**
 * Runs `fn` as the system on behalf of one tenant. A report from the bridge or a provider arrives with no user and no tenant; the
 * outbox takes its tenant from the context, so the work that follows a located campaign runs inside one.
 */
export function asSystem<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  return RequestContextStore.run(
    { requestId: `camp-report-${orgId}`, orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );
}

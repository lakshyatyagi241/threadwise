import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { FlowRunSource } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { FlowLaunchService, KINDS_OF_PROVIDER } from '../runtime/launch.service';
import { isOutsideBusinessHours } from './business-hours';
import { matchKeywordFlow, type KeywordFlow } from './keyword-match';

type Rows = { rows: Array<Record<string, unknown>> };

export interface OrderPlaced {
  orderId: string;
  contactId: number | null;
  phone: string | null;
  name?: string | null;
  email?: string | null;
  orderNumber?: string | null;
  totalMinor?: number | null;
  currency?: string | null;
  status?: string | null;
  invoiceUrl?: string | null;
  orderUrl?: string | null;
  paymentLink?: string | null;
}

/**
 * Who enters which flow (TW-FLR-001, 004 to 007): finds the live flows a trigger applies to and enrols the contact in each. Every
 * path is best effort per flow, as in Reference: one flow failing to launch never stops another, and never fails the tag, the contact
 * or the order that caused it (the outbox event is the cause; a failure is logged and the subscriber row, when there is one, says why).
 *
 * "Live" is published AND active; the lookup is by the workspace of the event, never across workspaces (Reference matched flows in any
 * workspace the contact's owner belonged to).
 */
@Injectable()
export class FlowTriggerService {
  private readonly logger = new Logger(FlowTriggerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly launch: FlowLaunchService,
  ) {}

  // --- audience triggers -----------------------------------------------------------------------------------------------------

  onTagAdded(orgId: number, contactId: number, tagId: number) {
    return this.enrolLive(orgId, 'tag_added', tagId, contactId, 'tag_added', null, {});
  }
  onGroupJoin(orgId: number, contactId: number, groupId: number) {
    return this.enrolLive(orgId, 'group_join', groupId, contactId, 'group_join', null, {});
  }
  onContactCreated(orgId: number, contactId: number) {
    return this.enrolLive(orgId, 'contact_created', 0, contactId, 'contact_created', null, {});
  }
  onOptIn(orgId: number, contactId: number) {
    return this.enrolLive(orgId, 'opt_in', 0, contactId, 'opt_in', null, {});
  }

  // --- event triggers --------------------------------------------------------------------------------------------------------

  /**
   * A deal entered a stage. The reference is the deal and the stage, so moving the same deal into the same stage again later is a new
   * reason (Reference ran such a flow once per contact, ever).
   */
  onDealStageChanged(orgId: number, contactId: number, stageId: number, dealUuid: string) {
    return this.enrolLive(
      orgId,
      'deal_stage_changed',
      stageId,
      contactId,
      'deal_stage_changed',
      `${dealUuid}:${stageId}`,
      {},
    );
  }

  /**
   * A new order. No contact for the number means nothing starts (no contact is invented for an order). The order tags are
   * variables of the run; an empty one is left out so it renders blank. Each order is its own reason, so a repeat buyer runs again.
   */
  async onOrderPlaced(orgId: number, o: OrderPlaced): Promise<number> {
    const contactId = o.contactId ?? (await this.contactByPhone(orgId, o.phone));
    if (contactId === null) return 0;
    const major = o.totalMinor != null ? (o.totalMinor / 100).toFixed(2) : '';
    const number = o.orderNumber || o.orderId;
    const variables: Record<string, unknown> = {
      name: o.name,
      first_name: o.name ? o.name.trim().split(/\s+/)[0] : undefined,
      email: o.email,
      order_number: number,
      order_name: number ? `#${number}` : undefined,
      total: major && o.currency ? `${major} ${o.currency}` : undefined,
      total_price: major || undefined,
      currency: o.currency,
      status: o.status,
      invoice_url: o.invoiceUrl || o.paymentLink,
      order_url: o.orderUrl,
      payment_link: o.paymentLink,
    };
    return this.enrolLive(
      orgId,
      'order_placed',
      0,
      contactId,
      'order_placed',
      `order:${o.orderId}`,
      variables,
    );
  }

  // --- inbound-condition triggers ---------------------------------------------------------------------------------------------

  /**
   * An inbound message while the workspace is in Away mode or outside its business hours starts the `away` / `out_of_hours` flows for
   * that customer (TW-FLR-007). The fast path: no query for flows unless one of the two conditions holds. `channelId` keeps the run
   * on the channel the customer wrote to.
   */
  async onInboundCondition(
    orgId: number,
    channelId: number,
    contactId: number | null,
    peerKey: string,
    now: Date = new Date(),
  ): Promise<number> {
    const kinds = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT inbox_away, business_hours, timezone FROM workspace_settings WHERE org_id = ${orgId}`,
      )) as unknown as Rows;
      const org = res.rows[0];
      if (!org) return [] as string[];
      const k: string[] = [];
      if (org.inbox_away === true) k.push('away');
      if (isOutsideBusinessHours(org.business_hours, String(org.timezone ?? 'UTC'), now))
        k.push('out_of_hours');
      return k;
    });
    if (kinds.length === 0) return 0;
    let started = 0;
    for (const kind of kinds) {
      started += await this.enrolLive(
        orgId,
        kind,
        0,
        contactId,
        kind as FlowRunSource,
        null,
        {},
        { channelId, peerKey },
      );
    }
    return started;
  }

  // --- keyword ---------------------------------------------------------------------------------------------------------------

  /** The flow a typed message starts on a channel, or null. */
  async keywordFlow(
    orgId: number,
    channelId: number,
    channelKind: string,
    text: string,
  ): Promise<KeywordFlow | null> {
    const all = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(sql`
        SELECT id, trigger_keywords, trigger_channel_id, provider, is_published, is_active FROM flows
        WHERE org_id = ${orgId} AND trigger_kind = 'keyword' AND coalesce(trigger_keywords, '') <> '' ORDER BY id`)) as unknown as Rows;
      return res.rows;
    });
    const live = all.filter((f) => f.is_published && f.is_active);
    const candidates: KeywordFlow[] = live
      .filter((f) => {
        if (f.trigger_channel_id !== null) return Number(f.trigger_channel_id) === channelId;
        return (KINDS_OF_PROVIDER[String(f.provider)] ?? []).includes(channelKind);
      })
      .map((f) => ({
        id: Number(f.id),
        keywords: String(f.trigger_keywords),
        channelId: f.trigger_channel_id === null ? null : Number(f.trigger_channel_id),
      }));
    const hit = matchKeywordFlow(candidates, text, channelId);
    if (!hit) {
      // The reason each keyword flow of the workspace was passed over, so "why did nothing start" can be read from the log.
      const reasons = all.map((f) => {
        const base = { flowId: Number(f.id), keywords: String(f.trigger_keywords) };
        if (!f.is_published) return { ...base, reason: 'not published' };
        if (!f.is_active) return { ...base, reason: 'not active' };
        if (f.trigger_channel_id !== null && Number(f.trigger_channel_id) !== channelId)
          return {
            ...base,
            reason: `tied to channel ${Number(f.trigger_channel_id)}, this message came in on channel ${channelId}`,
          };
        if (f.trigger_channel_id === null) {
          const kinds = KINDS_OF_PROVIDER[String(f.provider)] ?? [];
          if (!kinds.includes(channelKind))
            return {
              ...base,
              reason: `engine "${String(f.provider)}" carries ${kinds.join('/') || 'no channel'}, this channel is "${channelKind}"`,
            };
        }
        return { ...base, reason: 'channel fits, the typed text does not contain a keyword' };
      });
      this.logger.warn(
        { orgId, channelId, channelKind, typedLength: text.trim().length, flows: reasons },
        reasons.length === 0
          ? '[FLR] no flow with a keyword trigger exists in this workspace'
          : '[FLR] no keyword flow started: every flow was passed over',
      );
    }
    return hit;
  }

  // --- shared ----------------------------------------------------------------------------------------------------------------

  private async enrolLive(
    orgId: number,
    kind: string,
    value: number,
    contactId: number | null,
    source: FlowRunSource,
    triggerRef: string | null,
    variables: Record<string, unknown>,
    on?: { channelId: number; peerKey: string },
  ): Promise<number> {
    if (contactId === null && !on) return 0;
    const flowIds = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(sql`
        SELECT id FROM flows
        WHERE org_id = ${orgId} AND is_published AND is_active AND trigger_kind = ${kind}
          AND coalesce(trigger_value, 0) = ${value} ORDER BY id`)) as unknown as Rows;
      return res.rows.map((r) => Number(r.id));
    });
    let started = 0;
    for (const flowId of flowIds) {
      try {
        const out = await this.launch.start(orgId, {
          flowId,
          contactId,
          ...(on ? { channelId: on.channelId, peerKey: on.peerKey } : {}),
          source,
          triggerRef,
          variables,
          requirePublished: true,
          withSubscriber: contactId !== null,
        });
        if (out.outcome === 'started') started++;
      } catch (err) {
        this.logger.warn(
          { orgId, flowId, kind, err: (err as Error).message },
          '[FLR] enrolment from a trigger failed',
        );
      }
    }
    return started;
  }

  private async contactByPhone(orgId: number, phone: string | null): Promise<number | null> {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length < 6) return null;
    return this.db.txAs({ orgId }, async (tx: Tx) => {
      const res = (await tx.execute(sql`
        SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_phone = ${'+' + digits}
        ORDER BY id LIMIT 1`)) as unknown as Rows;
      const r = res.rows[0];
      return r ? Number(r.id) : null;
    });
  }
}

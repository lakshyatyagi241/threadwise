import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../../../chat-conversations';
import {
  EcomOrderHooks,
  type EcomFlowOrder,
  type EcomOrderListener,
} from '../../../../shopify-woocommerce';
import { FlowEngine } from '../../engine.service';
import { RunRepository } from '../../run.repository';
import type { RunState } from '../../types';
import { parseFormToken, WaFormRecords } from './wa-form-records';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where the outside world answers a commerce node (WD-FLR-041, 043): a WhatsApp Form submission and an order. Both are announced by
 * the domain that sees them (the inbox's stored inbound message, the store webhook's order hook) and turned here into
 * `FlowEngine.deliverExternal` for the run that is waiting, never for any other:
 *
 *  - a form submission (`nfm_reply`) is matched by the flow token the node sent (`form-<form>-<run>`), and must come from the same
 *    customer on the same channel as the run (WaDesk trusted the token alone); the answers are kept as a submission either way;
 *  - an order from a store carries `wadesk-flow:<run>` in its note (Shopify) or its meta (WooCommerce);
 *  - a WhatsApp catalog cart (an inbound order message) has no reference, so it is matched by the customer's run on that channel,
 *    as WaDesk matched it by phone.
 *
 * Worker process only, like the inbound listener of the engine itself.
 */
@Injectable()
export class CommerceResume implements InboundMessageListener, EcomOrderListener, OnModuleInit {
  readonly name = 'commerce-resume';
  private readonly logger = new Logger(CommerceResume.name);

  constructor(
    private readonly inbound: InboundMessageHooks,
    private readonly orders: EcomOrderHooks,
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly engine: FlowEngine,
    private readonly forms: WaFormRecords,
  ) {}

  onModuleInit(): void {
    this.inbound.register(this);
    this.orders.register(this);
  }

  // --- the customer's own message --------------------------------------------------------------------------------------------

  async onStored(e: InboundStoredEvent): Promise<{ consumed: boolean }> {
    const m = e.message;
    if (m.kind === 'interactive' && typeof m.meta.flowResponse === 'string') {
      return { consumed: await this.formSubmitted(e, m.meta.flowResponse) };
    }
    if (m.kind === 'unsupported' && m.meta.rawType === 'order') {
      return { consumed: await this.catalogOrder(e) };
    }
    return { consumed: false };
  }

  private async formSubmitted(e: InboundStoredEvent, raw: string): Promise<boolean> {
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      payload = parsed as Record<string, unknown>;
    } catch {
      this.logger.warn({ orgId: e.orgId }, '[FLR] a form response was not JSON');
      return false;
    }
    const token = typeof payload.flow_token === 'string' ? payload.flow_token : '';
    const parsed = parseFormToken(token);
    // Not a form this runtime sent: the forms domain's own submission path is another thing.
    if (!parsed) return false;

    const answers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) if (k !== 'flow_token') answers[k] = v;

    const recorded = await this.forms
      .record(e.orgId, {
        formId: parsed.formId,
        flowToken: token,
        callerPhone: e.peerKey,
        contactId: e.contactId,
        conversationId: e.conversationId,
        answers,
        meta: {
          messageId: e.messageUuid,
          ...(e.message.meta.flowName ? { name: e.message.meta.flowName } : {}),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn({ orgId: e.orgId, err }, '[FLR] a form submission could not be kept');
        return false;
      });

    const run = await this.runOf(e.orgId, parsed.runRef);
    const mine =
      run &&
      run.channelId === e.channelId &&
      run.peerKey === e.peerKey &&
      run.status === 'waiting' &&
      run.wait?.handler === 'WaForm' &&
      (run.wait.data as { flowToken?: string } | undefined)?.flowToken === token;
    if (!run || !mine) return recorded;
    const r = await this.engine.deliverExternal(e.orgId, run.id, 'WaForm', {
      answers,
      formId: parsed.formId,
      flowToken: token,
    });
    return r === 'routed' || recorded;
  }

  private async catalogOrder(e: InboundStoredEvent): Promise<boolean> {
    const live = await this.db.txAs({ orgId: e.orgId }, (tx) =>
      this.runs.liveByPeer(tx, e.orgId, e.channelId, e.peerKey),
    );
    if (!live || live.status !== 'waiting' || live.wait?.handler !== 'CommerceShop') return false;
    const r = await this.engine.deliverExternal(e.orgId, live.id, 'CommerceShop', {
      order: { id: '', total: '', currency: '', provider: 'whatsapp_shop' },
    });
    return r === 'routed';
  }

  // --- a store order ---------------------------------------------------------------------------------------------------------

  async onFlowOrder(o: EcomFlowOrder): Promise<void> {
    const run = await this.runOf(o.orgId, o.flowRef);
    if (!run || run.status !== 'waiting' || run.wait?.handler !== 'CommerceShop') return;
    await this.engine.deliverExternal(o.orgId, run.id, 'CommerceShop', {
      order: { id: o.orderId, total: o.total, currency: o.currency, provider: o.kind },
    });
  }

  private async runOf(orgId: number, ref: string): Promise<RunState | null> {
    // The reference came from a customer's message or a store's order note: only a run id is looked up, never anything else.
    if (!UUID.test(ref)) return null;
    return this.db.txAs({ orgId }, (tx) => this.runs.byUuid(tx, orgId, ref));
  }
}

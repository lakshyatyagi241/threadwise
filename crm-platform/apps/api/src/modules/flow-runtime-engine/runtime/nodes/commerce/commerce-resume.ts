import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { judgeAgeAnswer, WA_FORM_PRIVACY_MAP_KIND, type WaFormPrivacyMapField } from '@crm/contracts';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../../../chat-conversations';
import { ContactPrivacyService, MinorDetectionService } from '../../../../contact-consent';
import { ContactsService } from '../../../../crm';
import {
  EcomOrderHooks,
  type EcomFlowOrder,
  type EcomOrderListener,
} from '../../../../shopify-woocommerce';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../../../kernel/outbox/outbox-subscribers';
import { FlowEngine } from '../../engine.service';
import { RunRepository } from '../../run.repository';
import type { RunState } from '../../types';
import { flattenAnswer, parseFormToken, WaFormRecords, type FieldMapping } from './wa-form-records';

const PRIVACY_MAP_FIELDS = new Set<string>(Object.keys(WA_FORM_PRIVACY_MAP_KIND));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where the outside world answers a commerce node (TW-FLR-041, 043): a WhatsApp Form submission and an order. Both are announced by
 * the domain that sees them (the inbox's stored inbound message, the store webhook's order hook) and turned here into
 * `FlowEngine.deliverExternal` for the run that is waiting, never for any other:
 *
 *  - a form submission (`nfm_reply`) is matched by the flow token the node sent (`form-<form>-<run>`), and must come from the same
 *    customer on the same channel as the run (Reference trusted the token alone); the answers are kept as a submission either way;
 *  - an order from a store carries `threadwise-flow:<run>` in its note (Shopify) or its meta (WooCommerce);
 *  - a WhatsApp catalog cart (an inbound order message) has no reference, so it is matched by the customer's run on that channel,
 *    as Reference matched it by phone.
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
    private readonly contacts: ContactsService,
    private readonly minors: MinorDetectionService,
    private readonly privacy: ContactPrivacyService,
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

    if (recorded && e.contactId !== null)
      await this.applyFieldMappings(e.orgId, e.contactId, parsed.formId, token, answers);

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

  /**
   * A field the form builder marked "maps to" writes its answer onto the contact that submitted (TW-WFL, net addition: Reference
   * never does this). A contact property or a custom attribute reuses the flow engine's own safe field writer
   * (`ContactsService.setFieldFromFlow`) — same contact-column allow-list and active-custom-attribute check as the "Update
   * contact field" step, so a mapping that names a since-deleted attribute is skipped, not an error, and phone can never be
   * overwritten by a form answer. A privacy key (age/date-of-birth/consent) goes through `applyPrivacyMapping` instead. Best
   * effort throughout: one field failing to write never fails the submission itself, which is already kept.
   */
  private async applyFieldMappings(
    orgId: number,
    contactId: number,
    formId: number,
    flowToken: string,
    answers: Record<string, unknown>,
  ): Promise<void> {
    let mappings: Record<string, FieldMapping>;
    try {
      mappings = await this.forms.fieldMappings(orgId, formId);
    } catch (err) {
      this.logger.warn({ orgId, formId, err }, '[FLR] could not read the form field mappings');
      return;
    }
    for (const { fieldId, mapsTo, kind, label, value } of writesFor(mappings, answers)) {
      try {
        if (PRIVACY_MAP_FIELDS.has(mapsTo)) {
          await this.applyPrivacyMapping(
            orgId,
            contactId,
            { formId, flowToken, fieldId, label },
            mapsTo as WaFormPrivacyMapField,
            kind,
            value,
          );
        } else {
          await this.contacts.setFieldFromFlow(orgId, contactId, mapsTo, value);
        }
      } catch (err) {
        this.logger.warn(
          { orgId, formId, fieldId, mapsTo, err },
          '[FLR] a form answer could not be saved on the contact',
        );
      }
    }
  }

  /**
   * A field mapped to a privacy key answers an age/minor check or a consent grant instead of a contact property (TW-WFL net
   * addition — WhatsApp Forms had neither before). `privacyActionFor` decides what the answer means, purely; this just carries
   * that decision out against the real services.
   */
  private async applyPrivacyMapping(
    orgId: number,
    contactId: number,
    ctx: { formId: number; flowToken: string; fieldId: string; label: string },
    mapsTo: WaFormPrivacyMapField,
    kind: string,
    value: string,
  ): Promise<void> {
    const minAge = await this.db.txAs({ orgId, userId: null }, (tx) => this.privacy.minorAge(tx, orgId));
    const action = privacyActionFor(mapsTo, kind, value, minAge, new Date());
    if (action.kind === 'kind_mismatch') {
      this.logger.warn(
        { orgId, formId: ctx.formId, fieldId: ctx.fieldId, mapsTo, kind },
        '[FLR] a privacy mapping is on the wrong field kind: skipped',
      );
      return;
    }
    if (action.kind === 'none') return;
    const evidence = { formId: String(ctx.formId), fieldId: ctx.fieldId };

    if (action.kind === 'flag_minor') {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.minors.flagFromAnswer(tx, orgId, contactId, {
          source: action.source,
          minorUntil: action.minorUntil,
          evidence,
        }),
      );
      return;
    }

    await this.contacts.grantFromIntake(orgId, contactId, {
      channel: 'whatsapp',
      purpose: action.purpose,
      source: 'wa_form',
      text: ctx.label || undefined,
      evidence,
      idempotencyKey: `wa_form:${ctx.flowToken}:${ctx.fieldId}`,
    });
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

  /**
   * A catalog cart the WABA domain captured as an order (`whatsapp.order.received`): the cart never becomes a chat bubble there, so the
   * resume cannot ride on the stored inbound message; it is matched the same way, by the customer's live run on the channel of the
   * number the cart was sent to (`channels.waba_config_id`).
   */
  async catalogCart(orgId: number, configId: number, phone: string): Promise<boolean> {
    const peer = phone.replace(/\D+/g, '');
    const live = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT id FROM channels WHERE org_id = ${orgId} AND waba_config_id = ${configId} ORDER BY id LIMIT 1`,
      )) as unknown as { rows: Array<{ id: number | string }> };
      const channel = res.rows[0];
      return channel ? this.runs.liveByPeer(tx, orgId, Number(channel.id), peer) : null;
    });
    if (!live || live.status !== 'waiting' || live.wait?.handler !== 'CommerceShop') return false;
    const r = await this.engine.deliverExternal(orgId, live.id, 'CommerceShop', {
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

/** Of a form's field mappings, the ones this submission actually has a non-blank answer for, flattened and ready to write. */
export function writesFor(
  mappings: Record<string, FieldMapping>,
  answers: Record<string, unknown>,
): Array<{ fieldId: string; mapsTo: string; kind: string; label: string; value: string }> {
  const out: Array<{ fieldId: string; mapsTo: string; kind: string; label: string; value: string }> = [];
  for (const [fieldId, { mapsTo, kind, label }] of Object.entries(mappings)) {
    if (!(fieldId in answers)) continue;
    const value = flattenAnswer(answers[fieldId]);
    if (value !== '') out.push({ fieldId, mapsTo, kind, label, value });
  }
  return out;
}

export type PrivacyAction =
  | { kind: 'kind_mismatch' }
  | { kind: 'none' }
  | { kind: 'flag_minor'; source: 'dob' | 'declaration'; minorUntil: string | null }
  | { kind: 'grant'; purpose: 'marketing' | 'utility' };

/**
 * What a privacy-mapped field's answer means, purely: the field's own `kind` must match what the privacy key needs
 * (`WA_FORM_PRIVACY_MAP_KIND`) — a builder edit that changes a mapped field's kind must not misread the answer. Age/date-of-birth
 * only flags under `minAge` (an adult answer is `none` — there is no "adult" fact to record); consent always grants (`writesFor`
 * already filtered out a blank/unticked answer before this runs).
 */
export function privacyActionFor(
  mapsTo: WaFormPrivacyMapField,
  fieldKind: string,
  value: string,
  minAge: number,
  now: Date,
): PrivacyAction {
  if (WA_FORM_PRIVACY_MAP_KIND[mapsTo] !== fieldKind) return { kind: 'kind_mismatch' };
  if (mapsTo === 'privacy:consent_marketing') return { kind: 'grant', purpose: 'marketing' };
  if (mapsTo === 'privacy:consent_service') return { kind: 'grant', purpose: 'utility' };
  const verdict = judgeAgeAnswer(
    mapsTo === 'privacy:age' ? { mode: 'age', age: value } : { mode: 'dob', dob: value },
    minAge,
    now,
  );
  if (verdict.kind !== 'under') return { kind: 'none' };
  return {
    kind: 'flag_minor',
    source: verdict.mode === 'declaration' ? 'declaration' : 'dob',
    minorUntil: verdict.minorUntil,
  };
}

/** Hears `whatsapp.order.received` (TW-WABA-042) and hands the cart to `CommerceResume`. Worker only, like the resume itself. */
@Injectable()
export class CatalogCartResume implements OutboxSubscriber, OnModuleInit {
  readonly name = 'commerce-cart-resume';
  readonly eventTypes = ['whatsapp.order.received'] as const;

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly resume: CommerceResume,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    if (typeof p.phone !== 'string' || typeof p.connectionId !== 'number') return;
    await this.resume.catalogCart(event.orgId, p.connectionId, p.phone);
  }
}

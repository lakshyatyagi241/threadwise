import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { CommerceConsentService } from './commerce-consent.service';
import {
  COMMERCE_SENDER,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomTemplates,
} from './_shims/tokens';
import {
  applyVarMap,
  shopifyContext,
  shopifyRecipient,
  wooContext,
  wooRecipient,
  type EventContext,
  type StoreFacts,
} from './event-rules';
import { EventsRepository, type EventConfig } from './events.repository';
import type { StoreKind } from './mirror-rules';
import { StoresRepository } from './stores.repository';

type Json = Record<string, unknown>;

export interface MessageOutcome {
  status: 'sent' | 'failed' | 'skipped';
  recipient: string | null;
  error: string | null;
  response: unknown;
}

const digits = (v: string | null): string => (v ?? '').replace(/\D/g, '');

/**
 * Sends the WhatsApp message an automation maps to (TW-ECOM-010): fills the template from the order, picks the recipients (the
 * customer, the admin number, or both) and sends one by one. A failure is returned for the log, never thrown past the pipeline.
 *
 * Consent (BL-141 follow-up): the CUSTOMER of a MARKETING template (an abandoned-cart reminder, a reward, a back-in-stock alert set up
 * as marketing) is cleared by the ConsentGate first; one the gate refuses is not messaged and the outcome says `skipped` with the
 * closed-set reason in `Not messaged: consent (<reason>)`. A utility template (order confirmation, shipping and payment status) is never
 * asked about, and the merchant's admin number is not a customer.
 */
@Injectable()
export class EventMessageService {
  private readonly logger = new Logger(EventMessageService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
    private readonly consent: CommerceConsentService,
  ) {}

  /** The automation of this event, or undefined when it is off or has no template (nothing to send, not an error). */
  async config(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    eventType: string,
  ): Promise<EventConfig | undefined> {
    const c = await this.db.txAs({ orgId }, (tx) =>
      this.events.find(tx, orgId, kind, storeId, eventType),
    );
    return c && c.isActive && c.templateId !== null ? c : undefined;
  }

  async send(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    cfg: EventConfig,
    data: Json,
    reference: string,
    opts: {
      /** Values added to the event's variables (the COD risk level). */
      extra?: Record<string, string>;
      /** Fired by the pipeline rather than a webhook topic of its own: goes to the customer only, whatever `sendTo` says. */
      customerOnly?: boolean;
    } = {},
  ): Promise<MessageOutcome> {
    const loaded = await this.db.txAs({ orgId }, async (tx) => {
      const store = await this.stores.storeById(tx, orgId, kind, storeId);
      const template = cfg.templateId
        ? await this.templates.sendable(tx, orgId, cfg.templateId)
        : undefined;
      return { store, template };
    });
    if (!loaded.store) return fail('The store is gone.');
    if (!loaded.template) return fail('The template is missing or not approved by Meta yet.');
    const { store, template } = loaded;

    const facts: StoreFacts = {
      storeName: store.storeName,
      storeUrl: store.storeUrl,
      currency: 'shopCurrency' in store ? store.shopCurrency : store.storeCurrency,
    };
    const base = kind === 'shopify' ? shopifyContext(facts, data) : wooContext(facts, data);
    const ctx: EventContext = applyVarMap(
      opts.extra ? { ...base, vars: { ...base.vars, ...opts.extra } } : base,
      cfg.varMap,
    );
    const sendTo = opts.customerOnly ? 'customer' : cfg.sendTo;
    const customer = digits(kind === 'shopify' ? shopifyRecipient(data) : wooRecipient(data));
    const admin = sendTo !== 'customer' ? digits(cfg.adminNumber) : '';
    const to = [...(sendTo !== 'admin' && customer ? [customer] : []), ...(admin ? [admin] : [])];
    if (to.length === 0)
      return {
        status: 'skipped',
        recipient: null,
        error: 'No phone number to send to.',
        response: null,
      };

    const chosen = (store.metadata as { senderKey?: unknown } | null)?.senderKey;
    const senderKey = kind === 'woocommerce' && typeof chosen === 'string' ? chosen : null;
    const sent: string[] = [];
    const errors: string[] = [];
    const notes: string[] = [];
    const refused: string[] = [];
    const response: unknown[] = [];
    for (const dest of [...new Set(to)]) {
      // The customer is asked (a marketing template); the merchant's own number, when it is not also the customer's, is not.
      const verdict =
        dest === admin && dest !== customer
          ? { ok: true as const, clearance: this.consent.staff() }
          : await this.consent.clearCustomer(orgId, template.category, dest);
      if (!verdict.ok) {
        refused.push(dest);
        notes.push(verdict.note);
        response.push({ to: dest, skipped: verdict.reason });
        continue;
      }
      try {
        const out = await this.sender.send(orgId, {
          to: dest,
          template,
          ctx,
          reference,
          senderKey,
          consent: verdict.clearance,
        });
        sent.push(dest);
        response.push({ to: dest, id: out.providerMessageId });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'The message was not sent.';
        this.logger.warn(
          { orgId, kind, storeId, event: cfg.eventType, err },
          'event message failed',
        );
        errors.push(`${dest}: ${reason}`);
      }
    }
    return {
      status:
        errors.length > 0 ? 'failed' : sent.length === 0 && refused.length > 0 ? 'skipped' : 'sent',
      recipient: sent.join(',') || (errors.length === 0 ? refused.join(',') : '') || null,
      error: [...errors, ...notes].join('; ') || null,
      response,
    };
  }
}

const fail = (error: string): MessageOutcome => ({
  status: 'failed',
  recipient: null,
  error,
  response: null,
});

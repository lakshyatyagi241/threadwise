import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  COMMERCE_SENDER,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomTemplates,
} from './_shims/tokens';
import {
  applyVarMap,
  bodyParams,
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
 * Sends the WhatsApp message an automation maps to (WD-ECOM-010): fills the template from the order, picks the recipients (the
 * customer, the admin number, or both) and sends one by one. A failure is returned for the log, never thrown past the pipeline.
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
    const ctx: EventContext = applyVarMap(
      kind === 'shopify' ? shopifyContext(facts, data) : wooContext(facts, data),
      cfg.varMap,
    );
    const customer = digits(kind === 'shopify' ? shopifyRecipient(data) : wooRecipient(data));
    const to = [
      ...(cfg.sendTo !== 'admin' && customer ? [customer] : []),
      ...(cfg.sendTo !== 'customer' && digits(cfg.adminNumber) ? [digits(cfg.adminNumber)] : []),
    ];
    if (to.length === 0)
      return {
        status: 'skipped',
        recipient: null,
        error: 'No phone number to send to.',
        response: null,
      };

    const params = bodyParams(template.body, ctx.positional);
    const sent: string[] = [];
    const errors: string[] = [];
    const response: unknown[] = [];
    for (const dest of [...new Set(to)]) {
      try {
        const out = await this.sender.send(orgId, { to: dest, template, params, reference });
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
      status: errors.length > 0 ? 'failed' : 'sent',
      recipient: sent.join(',') || null,
      error: errors.join('; ') || null,
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

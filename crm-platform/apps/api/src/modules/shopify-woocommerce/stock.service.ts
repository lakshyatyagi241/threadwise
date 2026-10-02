import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  COMMERCE_SENDER,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomTemplates,
} from './_shims/tokens';
import { bodyParams, matchOutOfStock, wantsStockAlert } from './event-rules';
import { EventMessageService } from './event-message.service';
import { EventsRepository } from './events.repository';
import { MirrorRepository } from './mirror.repository';
import { shopifyInStock, wooInStock, type StoreKind } from './mirror-rules';
import { StockRepository } from './stock.repository';
import { StoresRepository } from './stores.repository';
import { e164 } from './woo-phone';

type Json = Record<string, unknown>;
const digits = (v: string): string => v.replace(/\D/g, '');
const text = (x: unknown): string | null =>
  typeof x === 'string' && x !== '' ? x : typeof x === 'number' ? String(x) : null;

/**
 * Back-in-stock alerts (TW-ECOM-020). A customer who asks to be told about a sold-out product joins its waitlist; when a product
 * update turns it from out of stock to in stock, everyone waiting is messaged once.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly message: EventMessageService,
    private readonly mirror: MirrorRepository,
    private readonly stock: StockRepository,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
  ) {}

  /** A customer's message. True when it asked for an alert on a sold-out product and the customer was put on the list. */
  async optIn(orgId: number, kind: StoreKind, rawPhone: string, body: string): Promise<boolean> {
    const phone = digits(rawPhone);
    if (phone === '' || !wantsStockAlert(body)) return false;
    const joined = await this.db.txAs({ orgId }, async (tx) => {
      const product = matchOutOfStock(body, await this.mirror.outOfStock(tx, orgId, kind));
      if (!product) return null;
      const store =
        kind === 'shopify'
          ? await this.stores.latestShopify(tx, orgId)
          : await this.stores.latestWoo(tx, orgId);
      if (!store) return null;
      await this.stock.join(tx, orgId, kind, store.id, {
        storeProductId: product.storeProductId,
        productName: product.name,
        phone,
      });
      return product;
    });
    if (!joined) return false;
    await this.sender
      .sendText(orgId, {
        to: phone,
        body: `Done! We'll message you the moment "${joined.name}" is back in stock.`,
        reference: `ecom-stock-ack-${kind}-${joined.id}`,
      })
      .catch((err: unknown) => this.logger.debug({ err }, 'stock opt-in acknowledgement not sent'));
    return true;
  }

  /**
   * A product update. Must run BEFORE the mirror is updated: the previous stock state is read from the mirror, and only an
   * out-to-in transition fires.
   */
  async onProductUpdate(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    data: Json,
  ): Promise<void> {
    const pid = text(data.id);
    if (!pid) return;
    const existing = await this.db.txAs({ orgId }, (tx) =>
      this.mirror.productByStoreId(tx, orgId, kind, pid),
    );
    const nowIn = kind === 'shopify' ? shopifyInStock(data) : wooInStock(data);
    if (!existing || existing.inStock || !nowIn) return;

    const cfg = await this.message.config(orgId, kind, storeId, 'stock/back');
    if (!cfg) return;
    const loaded = await this.db.txAs({ orgId }, async (tx) => ({
      store: await this.stores.storeById(tx, orgId, kind, storeId),
      template: cfg.templateId
        ? await this.templates.sendable(tx, orgId, cfg.templateId)
        : undefined,
      waiters: await this.stock.waiting(tx, orgId, kind, pid),
    }));
    if (!loaded.store || !loaded.template || loaded.waiters.length === 0) return;
    const { store, template, waiters } = loaded;

    const name =
      (kind === 'shopify' ? text(data.title) : text(data.name)) ??
      (existing.name || 'your product');
    const url =
      kind === 'shopify'
        ? `https://${store.storeUrl}/products/${text(data.handle) ?? ''}`
        : (text(data.permalink) ?? existing.productUrl ?? '');
    const positional = ['there', name, url];
    const params = bodyParams(template.body, positional);

    let sent = 0;
    for (const w of waiters) {
      // A WooCommerce waitlist row can hold a raw local number; an international one passes through unchanged.
      const to = kind === 'woocommerce' ? (e164(w.phone) ?? w.phone) : w.phone;
      try {
        await this.sender.send(orgId, {
          to,
          template,
          params,
          reference: `ecom-stock-${kind}-${storeId}-${w.id}`,
        });
        sent += 1;
      } catch (err) {
        this.logger.warn({ orgId, kind, storeId, err }, 'back-in-stock message failed');
      }
      // Marked notified whether or not the send worked, as Reference: a customer is told at most once per restock.
      await this.db.txAs({ orgId }, (tx) => this.stock.markNotified(tx, orgId, kind, w.id));
    }
    await this.db.txAs({ orgId }, (tx) =>
      this.events.log(tx, orgId, kind, storeId, {
        eventType: 'stock/back',
        status: sent > 0 ? 'sent' : 'failed',
        recipient: `${waiters.length} waiting`,
        payload: { product: name, notified: sent },
      }),
    );
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { WOOCOMMERCE, type WooFactory } from '../../infra/providers/ecom/ecom.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  COMMERCE_SENDER,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomTemplates,
} from './_shims/tokens';
import { accountSummary, applyVarMap, conciergeIntent, isPositiveRating } from './event-rules';
import { CheckoutLinkService } from './checkout-link.service';
import { EventMessageService } from './event-message.service';
import { EventsRepository } from './events.repository';
import { MirrorRepository } from './mirror.repository';
import { StoresRepository, type WooRow } from './stores.repository';

const ADDRESS_WINDOW_SECONDS = 15 * 60;
const MIN_ADDRESS_LENGTH = 6;
const MAX_ADDRESS_LENGTH = 250;
const REWARD_COOLDOWN_DAYS = 30;
const REWARD_RECENT_DAYS = 30;

interface PendingEdit {
  wooOrderId: string;
  orderName: string;
}

/**
 * The WooCommerce concierge on WhatsApp (WD-ECOM-031): a known customer changes the address of an order that has not shipped,
 * re-orders the last basket, asks for an account summary, or earns a reward for a good rating. Unknown customers get no answer from
 * any of them, so a message from someone else is never taken. Each handler returns true once it has taken the message.
 */
@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly mirror: MirrorRepository,
    private readonly checkout: CheckoutLinkService,
    private readonly message: EventMessageService,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async handleInbound(orgId: number, rawPhone: string, text: string): Promise<boolean> {
    const phone = rawPhone.replace(/\D/g, '');
    const body = text.trim();
    if (phone === '' || body === '') return false;
    const store = await this.db.txAs({ orgId }, (tx) => this.stores.latestWoo(tx, orgId));
    if (!store || store.consumerKey === '') return false;

    // A guided address edit in progress: THIS message is the address.
    const key = `ecom:addr-edit:${orgId}:${phone}`;
    const pending = await this.pending(key);
    if (pending) return this.applyAddress(orgId, store, phone, body, pending, key);

    switch (conciergeIntent(body)) {
      case 'edit-address':
        return this.requestAddress(orgId, store, phone, key);
      case 'reorder':
        return this.reorder(orgId, store, phone);
      case 'points':
        return this.points(orgId, store, phone);
      default:
        // The reward is the loosest trigger, so it is last and gated three ways.
        return this.reward(orgId, store, phone, body.toLowerCase());
    }
  }

  private async pending(key: string): Promise<PendingEdit | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as PendingEdit) : null;
    } catch {
      return null;
    }
  }

  private reply(orgId: number, phone: string, body: string, ref: string): Promise<void> {
    return this.sender.sendText(orgId, { to: phone, body, reference: ref }).then(
      () => undefined,
      (err: unknown) => this.logger.warn({ orgId, err }, '[WC-CONCIERGE] reply failed'),
    );
  }

  private log(
    orgId: number,
    store: WooRow,
    type: string,
    status: 'sent' | 'failed',
    phone: string,
    payload: unknown,
    response?: unknown,
  ): Promise<unknown> {
    return this.db.txAs({ orgId }, async (tx) => {
      const ref = await this.events.log(tx, orgId, 'woocommerce', store.id, {
        eventType: type,
        status,
        recipient: phone,
        payload,
      });
      if (response !== undefined)
        await this.events.setLog(tx, orgId, 'woocommerce', ref, { status, response });
    });
  }

  private async requestAddress(
    orgId: number,
    store: WooRow,
    phone: string,
    key: string,
  ): Promise<boolean> {
    // Editable: not yet shipped or cancelled (mirror status new = pending or on hold, paid = processing).
    const order = await this.db.txAs({ orgId }, (tx) =>
      this.mirror.latestWooOrder(tx, orgId, phone, ['new', 'paid']),
    );
    if (!order) {
      await this.reply(
        orgId,
        phone,
        "We couldn't find an order that's still editable — once an order ships the address is locked. Please contact support if you need help.",
        `ecom-addr-none-${store.id}`,
      );
      return true;
    }
    const name = order.name ?? `#${order.wooOrderId}`;
    const edit: PendingEdit = { wooOrderId: order.wooOrderId, orderName: name };
    await this.redis.set(key, JSON.stringify(edit), 'EX', ADDRESS_WINDOW_SECONDS);
    await this.reply(
      orgId,
      phone,
      `Sure — reply with your full updated shipping address for order ${name} in one message (flat/house, street, city, state, pincode).`,
      `ecom-addr-ask-${store.id}`,
    );
    await this.log(orgId, store, 'order/edit-request', 'sent', phone, { order: name });
    return true;
  }

  private async applyAddress(
    orgId: number,
    store: WooRow,
    phone: string,
    address: string,
    pending: PendingEdit,
    key: string,
  ): Promise<boolean> {
    if ([...address].length < MIN_ADDRESS_LENGTH) {
      // Keep the window open: the next message can still be the address.
      await this.reply(
        orgId,
        phone,
        'That looks too short — please send your full shipping address in one message.',
        `ecom-addr-short-${store.id}`,
      );
      return true;
    }
    const ok = await this.api(store).updateOrder(pending.wooOrderId, {
      shipping: { address_1: [...address].slice(0, MAX_ADDRESS_LENGTH).join('') },
    });
    await this.redis.del(key).catch(() => undefined);
    await this.reply(
      orgId,
      phone,
      ok
        ? `Done — the shipping address for order ${pending.orderName} has been updated. Thank you!`
        : `Sorry, we couldn't update order ${pending.orderName} automatically. Our team has been notified — please contact support.`,
      `ecom-addr-apply-${store.id}`,
    );
    await this.log(orgId, store, 'order/edit-apply', ok ? 'sent' : 'failed', phone, {
      order: pending.orderName,
    });
    return true;
  }

  private async reorder(orgId: number, store: WooRow, phone: string): Promise<boolean> {
    const last = await this.db.txAs({ orgId }, (tx) =>
      this.mirror.latestWooOrder(tx, orgId, phone),
    );
    if (!last) return false;
    const items = last.items
      .filter((i): i is { sku: string; qty: number } => i.sku !== null)
      .map((i) => ({ reference: i.sku, qty: i.qty }));
    if (items.length === 0) return false;
    try {
      const link = await this.checkout.wooLink(orgId, store, items, null);
      if (!link) return false;
      await this.sender.sendText(orgId, {
        to: phone,
        body: `Here's your re-order — same items as last time. Tap to checkout:\n${link.url}`,
        reference: `ecom-reorder-${store.id}-${link.ref ?? ''}`,
      });
      await this.log(orgId, store, 'reorder', 'sent', phone, { order: last.name });
      return true;
    } catch (err) {
      this.logger.warn({ orgId, err }, '[WC-CONCIERGE] reorder failed');
      return false;
    }
  }

  private async points(orgId: number, store: WooRow, phone: string): Promise<boolean> {
    const found = await this.db.txAs({ orgId }, async (tx) => ({
      totals: await this.mirror.wooTotals(tx, orgId, phone),
      points: await this.mirror.pointsBalance(tx, orgId, phone),
    }));
    // An unknown customer: let the other handlers try.
    if (found.totals.orders === 0) return false;
    try {
      await this.sender.sendText(orgId, {
        to: phone,
        body: accountSummary({
          orders: found.totals.orders,
          spentMinor: found.totals.spentMinor,
          currency: store.storeCurrency ?? '',
          points: found.points,
        }),
        reference: `ecom-points-${store.id}`,
      });
      await this.log(orgId, store, 'loyalty/query', 'sent', phone, { orders: found.totals.orders });
      return true;
    } catch (err) {
      this.logger.warn({ orgId, err }, '[WC-CONCIERGE] points failed');
      return false;
    }
  }

  /** A good rating from a recent buyer unlocks the merchant's reward template, once per number per 30 days. */
  private async reward(
    orgId: number,
    store: WooRow,
    phone: string,
    text: string,
  ): Promise<boolean> {
    if (!isPositiveRating(text)) return false;
    const gates = await this.db.txAs({ orgId }, async (tx) => ({
      delivered: await this.mirror.hasRecentShipped(tx, orgId, phone, REWARD_RECENT_DAYS),
      rewarded: await this.events.recentFor(
        tx,
        orgId,
        'woocommerce',
        store.id,
        'review/reward',
        phone,
        REWARD_COOLDOWN_DAYS,
      ),
    }));
    if (!gates.delivered || gates.rewarded) return false;
    const cfg = await this.message.config(orgId, 'woocommerce', store.id, 'review/reward');
    if (!cfg) return false;
    const template = await this.db.txAs({ orgId }, async (tx) =>
      cfg.templateId ? await this.templates.sendable(tx, orgId, cfg.templateId) : undefined,
    );
    if (!template) return false;

    const storeName = store.storeName || store.storeUrl;
    const ctx = applyVarMap(
      { vars: { name: 'there', store_name: storeName }, positional: ['there', storeName, ''] },
      cfg.varMap,
    );
    try {
      const out = await this.sender.send(orgId, {
        to: phone,
        template,
        ctx,
        reference: `ecom-reward-${store.id}-${phone}`,
        senderKey:
          typeof (store.metadata as { senderKey?: unknown } | null)?.senderKey === 'string'
            ? (store.metadata as { senderKey: string }).senderKey
            : null,
      });
      await this.log(
        orgId,
        store,
        'review/reward',
        'sent',
        phone,
        { rating: text },
        { id: out.providerMessageId },
      );
    } catch (err) {
      await this.log(
        orgId,
        store,
        'review/reward',
        'failed',
        phone,
        { rating: text },
        {
          error: err instanceof Error ? err.message : 'not sent',
        },
      );
    }
    return true;
  }

  private api(store: WooRow) {
    return this.woo.store(
      store.storeUrl,
      this.crypto.decrypt(store.consumerKey),
      this.crypto.decrypt(store.consumerSecret),
    );
  }
}

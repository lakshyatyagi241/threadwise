import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  formatProductMoney,
  type OrderCancelInput,
  type OrderCancelResult,
  type OrderConfirmInput,
  type OrderConfirmResult,
  type OrderLine,
  type OrderParseInput,
  type OrderParseResult,
  type OrderReplyInput,
  type OrderReplyResult,
  type OrderShippingInput,
  type OrderShippingResult,
  type SavedShipping,
} from '@crm/contracts';
import { AppError } from '../../../../../common/errors/app-error';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { OutboxService } from '../../../../../kernel/outbox/outbox.service';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../../../crm/contact-resolver.port';
import {
  ORDER_GROUP_NOTIFY_PORT,
  ORDER_MEDIA_PORT,
  type OrderGroupNotifyPort,
  type OrderMediaPort,
} from '../../../../../infra/providers/flow-runtime-engine/ordering.port';
import { InventoryService, matchProduct, retailerIdOf } from '../../../../catalog-products';
import { TranslationService } from '../../../../localization-translation';
import { AiCallService } from './ai-call.service';
import { tryParseJson } from './ai-rules';
import {
  ORDER_PARSE_SYSTEM,
  SHIPPING_SYSTEM,
  buildConfirmedText,
  buildSummary,
  cartRef,
  digitsOf,
  intentOf,
  looksLikePlaceholder,
  normalizeItems,
  offlineEnglish,
  shippingText,
  type ReplyIntent,
  type Unavailable,
} from './ordering-rules';

const DEFAULT_MODEL = 'gpt-4o-mini';
/** How long a cart holds its stock (Reference `InventoryService::DEFAULT_TTL_SECONDS`). */
const CART_TTL_SECONDS = 1800;

type Row = Record<string, unknown>;

interface ProductRow {
  id: number;
  sku: string | null;
  name: string;
  aliases: unknown;
  priceMinor: number;
  currency: string | null;
  stockQty: number | null;
  reservedQty: number;
  imageUrl: string | null;
  metaRetailerId: string | null;
}

interface ShipParts {
  useSaved: boolean;
  name: string;
  company: string;
  address: string;
}

const NO_SHIP: ShipParts = { useSaved: false, name: '', company: '', address: '' };

/**
 * Natural-language ordering for flows (TW-FLR-042): the five calls a flow's Webhook node makes at an ordering flow. The customer's
 * free text goes to a model that lists the items; each item is matched to a catalog product and its stock held; the customer sees a
 * summary (in their own language) and is asked for a delivery address, whose reply is the confirmation; Confirm turns the held cart
 * into an order and settles the stock, Cancel gives the stock back.
 *
 *   parse     text -> items -> match -> hold -> cart, summary and the address prompt
 *   shipping  the reply to the address prompt: the saved address, or a new one split into name, company and address
 *   confirm   the cart becomes an order (`whatsapp_ai`), holds are committed, the group is told
 *   cancel    holds released, cart cancelled
 *   reply     one call for the reply to the summary: confirm, cancel, or ask again
 *
 * Compared with Reference: the workspace comes from the API key and not from the body; translation goes through the shared translation
 * service (Reference called an unofficial Google endpoint on its own); a model with no key, or over its monthly allowance, reads as an
 * empty order and the customer is told no item could be added; voice and photo orders and the group post go through ports whose
 * providers are not built yet (see `ordering.port.ts`), so today an order is read from its text.
 */
@Injectable()
export class OrderingFlowService {
  private readonly logger = new Logger(OrderingFlowService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ai: AiCallService,
    private readonly inventory: InventoryService,
    private readonly translation: TranslationService,
    @Inject(ORDER_MEDIA_PORT) private readonly media: OrderMediaPort,
    @Inject(ORDER_GROUP_NOTIFY_PORT) private readonly group: OrderGroupNotifyPort,
    private readonly outbox: OutboxService,
    @Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolverPort,
  ) {}

  // --- parse ----------------------------------------------------------------------------------------------------------------

  async parse(orgId: number, input: OrderParseInput): Promise<OrderParseResult> {
    const phone = input.customer_phone;
    const digits = digitsOf(phone);
    const ref = cartRef(orgId, phone);
    const model = input.model ?? DEFAULT_MODEL;
    const text = input.text ?? '';

    // A new order replaces any cart in flight: free its holds first.
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.inventory.releaseByRef(tx, orgId, ref),
    );

    const placeholder = looksLikePlaceholder(text);
    const media = await this.media.resolve(orgId, phone, placeholder).catch(() => null);
    let effective = text;
    let mediaType: 'voice' | 'image' | null = null;
    let transcript: string | null = null;
    if (media?.kind === 'voice' && media.voiceText) {
      effective = placeholder ? media.voiceText : `${text}\n${media.voiceText}`.trim();
      mediaType = 'voice';
      transcript = media.voiceText;
    } else if (media?.kind === 'image') {
      mediaType = 'image';
    }

    const parsed = await this.parseItems(orgId, effective, model);
    const lines: OrderLine[] = [];
    const unavailable: Unavailable[] = [];
    let totalMinor = 0;
    let currency: string | null = null;

    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const products = await this.products(tx, orgId);
      for (const it of parsed) {
        const m = matchProduct(
          products.map((p) => ({ ...p, aliases: p.aliases })),
          it.name,
        );
        const p = m.product;
        if (!p) {
          unavailable.push({ name: it.name, qty: it.qty, reason: 'not_found' });
          continue;
        }
        const held = await this.inventory.hold(tx, orgId, p.id, it.qty, ref);
        if (!held) {
          const left = p.stockQty === null ? null : Math.max(0, p.stockQty - p.reservedQty);
          unavailable.push({ name: p.name, qty: it.qty, reason: 'out_of_stock', available: left });
          continue;
        }
        currency = currency || p.currency;
        totalMinor += p.priceMinor * it.qty;
        lines.push({
          product_id: p.id,
          retailer_id: retailerIdOf({ id: p.id, sku: p.sku, metaRetailerId: p.metaRetailerId }),
          name: p.name,
          image_url: p.imageUrl,
          qty: it.qty,
          price_minor: p.priceMinor,
          currency: p.currency,
        });
      }
    });

    const lang = await this.confidentLang(orgId, effective);
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      if (lines.length === 0) {
        await tx.execute(
          sql`DELETE FROM wa_pending_orders WHERE org_id = ${orgId} AND customer_phone = ${digits}`,
        );
        return;
      }
      await tx.execute(sql`
        INSERT INTO wa_pending_orders (org_id, customer_phone, ref, items_json, unavailable_json, total_minor, currency_code,
                                       group_code, status, order_id, expires_at, customer_lang, order_media_path,
                                       order_media_type, order_media_transcript)
        VALUES (${orgId}, ${digits}, ${ref}, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(unavailable)}::jsonb, ${totalMinor},
                ${currency}, ${input.group_code ?? null}, 'pending', NULL, now() + make_interval(secs => ${CART_TTL_SECONDS}),
                ${lang === '' ? null : lang}, ${media?.path ?? null}, ${mediaType}, ${transcript})
        ON CONFLICT (org_id, customer_phone) DO UPDATE SET
          ref = EXCLUDED.ref, items_json = EXCLUDED.items_json, unavailable_json = EXCLUDED.unavailable_json,
          total_minor = EXCLUDED.total_minor, currency_code = EXCLUDED.currency_code, group_code = EXCLUDED.group_code,
          status = 'pending', order_id = NULL, expires_at = EXCLUDED.expires_at,
          customer_lang = COALESCE(EXCLUDED.customer_lang, wa_pending_orders.customer_lang),
          order_media_path = COALESCE(EXCLUDED.order_media_path, wa_pending_orders.order_media_path),
          order_media_type = COALESCE(EXCLUDED.order_media_type, wa_pending_orders.order_media_type),
          order_media_transcript = COALESCE(EXCLUDED.order_media_transcript, wa_pending_orders.order_media_transcript)`);
    });

    const saved = await this.shippingFor(orgId, phone);
    const askShipping =
      saved && saved.text !== ''
        ? `${await this.localize(orgId, 'Please confirm your delivery address:', effective)}\n\n${saved.text}\n\n` +
          (await this.localize(orgId, 'Reply YES to ship here, or send a new address.', effective))
        : await this.localize(
            orgId,
            'To place your order, reply with your delivery address: your Name, Company (optional), and Full address.',
            effective,
          );

    let summary = await this.localize(
      orgId,
      buildSummary(lines, unavailable, totalMinor, currency),
      effective,
    );
    if (lines.length === 0) {
      const avail = await this.availableProducts(orgId);
      if (avail !== '') {
        summary += `\n\n${await this.localize(orgId, `Here is what we have available right now:\n${avail}`, effective)}`;
      }
    }

    return {
      ok: true,
      ref,
      has_items: lines.length > 0,
      order_ok: lines.length > 0 ? 'yes' : 'no',
      items: lines,
      unavailable: unavailable.map((u) => ({ ...u, available: u.available ?? null })),
      total_minor: totalMinor,
      currency,
      saved_shipping: saved,
      summary,
      ask_shipping: askShipping,
      set_user_message: effective,
    };
  }

  // --- shipping -------------------------------------------------------------------------------------------------------------

  async shipping(orgId: number, input: OrderShippingInput): Promise<OrderShippingResult> {
    const phone = input.customer_phone;
    if (input.use_saved) {
      const s = await this.shippingFor(orgId, phone);
      if (!s) throw this.refused('no_saved_address');
      await this.setPendingShipping(orgId, phone, s.name, s.company, s.address);
      return { ok: true, shipping: s.text };
    }
    const res = await this.setPendingShippingFromText(
      orgId,
      phone,
      input.text ?? '',
      input.model ?? DEFAULT_MODEL,
    );
    if (!res.ok) throw this.refused('empty_address');
    return { ok: true, shipping: res.text };
  }

  /** The customer's ship-to on file: a profile the merchant set, else the address of their latest order. Null on a first order. */
  async shippingFor(orgId: number, customerPhone: string): Promise<SavedShipping | null> {
    const digits = digitsOf(customerPhone);
    if (digits === '') return null;
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const prof = (
        await tx.execute(
          sql`SELECT name, company, address FROM wa_customer_profiles WHERE org_id = ${orgId} AND phone = ${digits}`,
        )
      ).rows[0] as Row | undefined;
      if (
        prof &&
        ((prof.address as string | null)?.trim() || (prof.name as string | null)?.trim())
      ) {
        const name = String(prof.name ?? '');
        const company = String(prof.company ?? '');
        const address = String(prof.address ?? '');
        return { name, company, address, text: shippingText(name, company, address) };
      }
      const last = (
        await tx.execute(sql`
          SELECT customer_name, customer_address, meta_json->>'ship_company' AS company FROM wa_orders
          WHERE org_id = ${orgId} AND customer_phone = ${digits} AND coalesce(customer_address, '') <> ''
          ORDER BY id DESC LIMIT 1`)
      ).rows[0] as Row | undefined;
      if (!last) return null;
      const name = String(last.customer_name ?? '');
      const company = String(last.company ?? '');
      const address = String(last.customer_address ?? '');
      return { name, company, address, text: shippingText(name, company, address) };
    });
  }

  /** Saves the ship-to onto the cart in flight so Confirm writes it to the order. False when the customer has no pending cart. */
  async setPendingShipping(
    orgId: number,
    customerPhone: string,
    name = '',
    company = '',
    address = '',
  ): Promise<boolean> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        UPDATE wa_pending_orders SET ship_name = ${name.trim() || null}, ship_company = ${company.trim() || null},
                                     ship_address = ${address.trim() || null}
        WHERE org_id = ${orgId} AND customer_phone = ${digitsOf(customerPhone)} AND status = 'pending' RETURNING id`),
    );
    return res.rows.length > 0;
  }

  /**
   * Captures a delivery address from the customer's reply. One model call decides whether they confirmed the saved address (any
   * affirmative in any language) or sent a new one, split into name, company and address. A reply that gives no usable address is
   * stored whole as the address, so a thin parse never loses it.
   */
  async setPendingShippingFromText(
    orgId: number,
    customerPhone: string,
    rawText: string,
    model = DEFAULT_MODEL,
  ): Promise<{ ok: boolean; usedSaved: boolean; text: string }> {
    let raw = rawText.trim();
    if (raw === '' || looksLikePlaceholder(raw)) {
      const m = await this.media.resolve(orgId, customerPhone, true).catch(() => null);
      if (m?.kind === 'voice' && m.voiceText) raw = m.voiceText.trim();
    }
    if (raw === '') return { ok: false, usedSaved: false, text: '' };

    const saved = await this.shippingFor(orgId, customerPhone);
    const parts = await this.parseShipping(orgId, raw, model);
    if (parts.useSaved && saved) {
      await this.setPendingShipping(orgId, customerPhone, saved.name, saved.company, saved.address);
      return { ok: true, usedSaved: true, text: saved.text };
    }
    const address = parts.address.trim() || raw;
    await this.setPendingShipping(orgId, customerPhone, parts.name, parts.company, address);
    return { ok: true, usedSaved: false, text: shippingText(parts.name, parts.company, address) };
  }

  private async parseShipping(orgId: number, text: string, model: string): Promise<ShipParts> {
    const json = await this.callJson(orgId, model, SHIPPING_SYSTEM, text, 300, 0);
    if (!json || typeof json !== 'object') return NO_SHIP;
    const j = json as Record<string, unknown>;
    return {
      useSaved: j.use_saved === true || String(j.use_saved).toLowerCase() === 'true',
      name: String(j.name ?? '').trim(),
      company: String(j.company ?? '').trim(),
      address: String(j.address ?? '').trim(),
    };
  }

  // --- confirm and cancel ---------------------------------------------------------------------------------------------------

  async confirm(orgId: number, input: OrderConfirmInput): Promise<OrderConfirmResult> {
    const phone = input.customer_phone;
    const ship = (input.ship_text ?? '').trim();
    // The reply is read once, in any language: the saved address was confirmed, or this is a new one. Blank (a voice reply) is fine.
    await this.setPendingShippingFromText(orgId, phone, ship, input.model ?? DEFAULT_MODEL);

    const res = await this.place(orgId, phone);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        summary: await this.localize(
          orgId,
          'Sorry, we could not place your order — the item may be unavailable or your cart expired. Please send your order again.',
          ship,
        ),
      };
    }
    if (input.notify_group !== false) await this.notifyGroup(orgId, phone, res);
    return {
      ok: true,
      order_id: res.orderId,
      total_minor: res.totalMinor,
      currency: res.currency,
      summary: res.summary,
    };
  }

  async cancel(orgId: number, input: OrderCancelInput): Promise<OrderCancelResult> {
    const released = await this.release(orgId, input.customer_phone);
    return {
      ok: true,
      released,
      summary: await this.localize(
        orgId,
        'No problem — your order was cancelled. Send *order* any time to start again.',
        input.text ?? '',
      ),
    };
  }

  private async release(orgId: number, customerPhone: string): Promise<number> {
    const digits = digitsOf(customerPhone);
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const n = await this.inventory.releaseByRef(tx, orgId, cartRef(orgId, customerPhone));
      await tx.execute(sql`
        UPDATE wa_pending_orders SET status = 'cancelled'
        WHERE org_id = ${orgId} AND customer_phone = ${digits} AND status = 'pending'`);
      return n;
    });
  }

  /** The held cart becomes an order and its holds are settled. Never throws: a failure is `confirm_failed`. */
  private async place(
    orgId: number,
    customerPhone: string,
  ): Promise<
    | {
        ok: true;
        orderId: number;
        totalMinor: number;
        currency: string | null;
        summary: string;
        groupCode: string | null;
        customerLang: string | null;
      }
    | { ok: false; error: 'no_pending_order' | 'confirm_failed' }
  > {
    const digits = digitsOf(customerPhone);
    try {
      return await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const p = (
          await tx.execute(sql`
            SELECT id, ref, items_json, total_minor, currency_code, customer_lang, ship_name, ship_company, ship_address,
                   group_code, order_media_path, order_media_type, order_media_transcript
            FROM wa_pending_orders WHERE org_id = ${orgId} AND customer_phone = ${digits} AND status = 'pending' FOR UPDATE`)
        ).rows[0] as Row | undefined;
        const items = (Array.isArray(p?.items_json) ? p!.items_json : []) as OrderLine[];
        if (!p || items.length === 0)
          return { ok: false as const, error: 'no_pending_order' as const };

        const total = Number(p.total_minor);
        const currency = (p.currency_code as string | null) ?? null;
        const meta = Object.fromEntries(
          Object.entries({
            group_code: p.group_code,
            customer_lang: p.customer_lang,
            ship_company: p.ship_company,
            order_media_path: p.order_media_path,
            order_media_type: p.order_media_type,
            order_media_transcript: p.order_media_transcript,
          }).filter(([, v]) => v !== null && v !== undefined && v !== ''),
        );
        // The buyer is a contact of the workspace (the chat made one already: this finds it), in this transaction; a plan out of
        // contacts leaves the link empty and the order is still placed.
        const link = await this.contacts.findOrCreateByPhone(tx, orgId, {
          phone: digits,
          name: (p.ship_name as string | null) || null,
          address: (p.ship_address as string | null) || null,
          source: 'whatsapp_order',
          tag: 'Store customer',
          saveProfile: true,
        });
        const order = (
          await tx.execute(sql`
            INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, customer_address, items_json, total_minor,
                                   currency_code, status, meta_json, contact_id)
            VALUES (${orgId}, 'whatsapp_ai', ${digits}, ${(p.ship_name as string | null) || null},
                    ${(p.ship_address as string | null) || null}, ${JSON.stringify(items)}::jsonb, ${total},
                    ${currency ?? 'INR'}, 'pending', ${JSON.stringify(meta)}::jsonb,
                    ${link.outcome === 'skipped' ? null : link.contactId})
            RETURNING id, uuid`)
        ).rows[0] as Row;
        const orderId = Number(order.id);
        for (const li of items) {
          await tx.execute(sql`
            INSERT INTO wa_order_items (org_id, order_id, product_id, retailer_id, name, image_url, quantity, price_minor, currency_code)
            VALUES (${orgId}, ${orderId}, ${li.product_id ?? null}, ${li.retailer_id ?? `wsn-${li.product_id}`}, ${li.name ?? ''},
                    ${li.image_url ?? null}, ${li.qty ?? 1}, ${li.price_minor ?? 0}, ${li.currency ?? currency ?? 'INR'})`);
        }
        await this.inventory.commitByRef(tx, orgId, String(p.ref), orderId);
        await tx.execute(
          sql`UPDATE wa_pending_orders SET status = 'confirmed', order_id = ${orderId} WHERE org_id = ${orgId} AND id = ${Number(p.id)}`,
        );
        // The order exists now: the CRM's sales side (sales order, timeline, invoice) follows it through the outbox.
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: 'wa_orders',
          aggregateId: orderId,
          eventType: 'store.order_placed',
          payload: {
            orderNo: orderId,
            orderId: order.uuid,
            source: 'whatsapp_ai',
            customerPhone: digits,
            totalMinor: total,
            currencyCode: currency ?? 'INR',
            paymentMethod: 'prepaid',
            itemCount: items.length,
          },
        });
        return {
          ok: true as const,
          orderId,
          totalMinor: total,
          currency,
          groupCode: (p.group_code as string | null) ?? null,
          customerLang: (p.customer_lang as string | null) ?? null,
          summary: buildConfirmedText(orderId, items, total, currency, {
            name: p.ship_name as string | null,
            company: p.ship_company as string | null,
            address: p.ship_address as string | null,
          }),
        };
      });
    } catch (err) {
      this.logger.error({ err: String(err) }, '[FLR] ordering confirm failed');
      return { ok: false, error: 'confirm_failed' };
    }
  }

  /** The group post is best effort and never holds up the customer's reply. */
  private async notifyGroup(
    orgId: number,
    phone: string,
    res: { summary: string; groupCode: string | null; customerLang: string | null },
  ): Promise<void> {
    try {
      const r = await this.group.notify({
        orgId,
        customerPhone: phone,
        summary: res.summary,
        groupCode: res.groupCode,
        customerLang: res.customerLang,
      });
      if (!r.posted) this.logger.log({ reason: r.reason }, '[FLR] ordering: no group post');
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[FLR] ordering: the group post failed');
    }
  }

  // --- reply ----------------------------------------------------------------------------------------------------------------

  /**
   * What a reply means, in any language. The words are read as typed first (English needs no translation, and a translation
   * provider that answers with an error text must not decide an order); only when they are not decisive is the reply translated
   * to English and read again.
   */
  async decideReply(
    orgId: number,
    text: string,
  ): Promise<{ intent: ReplyIntent; english: string }> {
    const typed = text.trim().toLowerCase();
    const direct = intentOf(typed);
    if (direct !== 'unclear') return { intent: direct, english: typed };
    const english = (await this.toEnglish(orgId, text.trim())).text.toLowerCase().trim();
    return { intent: intentOf(english), english };
  }

  async reply(orgId: number, input: OrderReplyInput): Promise<OrderReplyResult> {
    const phone = input.customer_phone;
    const text = input.text ?? '';
    const L = (en: string) => this.localize(orgId, en, text);
    const { intent } = await this.decideReply(orgId, text);

    if (intent === 'cancel') {
      await this.release(orgId, phone);
      return {
        ok: true,
        intent,
        summary: await L(
          'No problem — your order was cancelled. Send *order* any time to start again.',
        ),
      };
    }
    // Unclear: ask again in their language. Never cancel on a guess.
    if (intent !== 'confirm') {
      return {
        ok: true,
        intent: 'unclear',
        summary: await L(
          "Sorry, I didn't catch that. Reply *CONFIRM* to place your order, or *CANCEL* to stop.",
        ),
      };
    }
    const res = await this.place(orgId, phone);
    if (!res.ok) {
      return {
        ok: true,
        intent: 'confirm',
        order_id: null,
        summary: await L(
          'Your cart has expired or was already placed. Please send your order again to start over.',
        ),
      };
    }
    if (input.notify_group !== false) await this.notifyGroup(orgId, phone, res);
    return {
      ok: true,
      intent: 'confirm',
      order_id: res.orderId,
      summary: await L(res.summary || 'Order placed.'),
    };
  }

  // --- the catalog and the model ---------------------------------------------------------------------------------------------

  private async products(
    tx: Parameters<Parameters<DatabaseService['txAs']>[1]>[0],
    orgId: number,
  ): Promise<ProductRow[]> {
    const res = await tx.execute(sql`
      SELECT id, sku, name, aliases_json, price_minor, currency_code, stock_qty, reserved_qty, image_url, meta_retailer_id
      FROM wa_products WHERE org_id = ${orgId} AND status = 'active' ORDER BY id`);
    return (res.rows as Row[]).map((r) => ({
      id: Number(r.id),
      sku: (r.sku as string | null) ?? null,
      name: String(r.name),
      aliases: r.aliases_json,
      priceMinor: Number(r.price_minor),
      currency: (r.currency_code as string | null) ?? null,
      stockQty: r.stock_qty === null ? null : Number(r.stock_qty),
      reservedQty: Number(r.reserved_qty ?? 0),
      imageUrl: (r.image_url as string | null) ?? null,
      metaRetailerId: (r.meta_retailer_id as string | null) ?? null,
    }));
  }

  /** A short "what is in stock" list for a customer whose items matched nothing: name, price and what is left. */
  async availableProducts(orgId: number, limit = 15): Promise<string> {
    const rows = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT name, price_minor, currency_code, stock_qty FROM wa_products
        WHERE org_id = ${orgId} AND status = 'active' AND (stock_qty IS NULL OR stock_qty > 0)
        ORDER BY sort_order, name LIMIT ${limit}`);
      return res.rows as Row[];
    });
    return rows
      .map((r) => {
        const left = r.stock_qty === null ? '' : ` (${Number(r.stock_qty)} left)`;
        return `• ${String(r.name)} — ${formatProductMoney(Number(r.price_minor), r.currency_code as string | null)}${left}`;
      })
      .join('\n');
  }

  private async callJson(
    orgId: number,
    model: string,
    system: string,
    user: string,
    maxTokens: number,
    temperature: number,
  ): Promise<unknown> {
    const out = await this.ai.call({
      orgId,
      model,
      systemPrompt: system,
      userPrompt: user,
      maxTokens,
      temperature,
      vendorJsonOnly: true,
    });
    if (!out.ok) {
      this.logger.warn({ error: out.error }, '[FLR] ordering model call gave nothing');
      return null;
    }
    return tryParseJson(out.reply);
  }

  private async parseItems(
    orgId: number,
    text: string,
    model: string,
  ): Promise<Array<{ name: string; qty: number }>> {
    if (text.trim() === '') return [];
    return normalizeItems(await this.callJson(orgId, model, ORDER_PARSE_SYSTEM, text, 600, 0.1));
  }

  // --- language -------------------------------------------------------------------------------------------------------------

  /** The text in English and the language it was written in. Best effort: the offline word map, then the text itself. */
  private async toEnglish(
    orgId: number,
    text: string,
  ): Promise<{ lang: string | null; text: string }> {
    if (text === '') return { lang: null, text: '' };
    try {
      const r = await this.translation.detectAndTranslate(text, 'en', { orgId });
      if (r.text) return { lang: r.language, text: r.text };
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[FLR] ordering: translation failed');
    }
    return { lang: null, text: offlineEnglish(text) ?? text };
  }

  /**
   * The customer's language, or '' for English or unknown. A short English order mis-tagged as a Latin-script language is
   * ignored: if translating ASCII text to English left it unchanged, it was English. Other scripts are trusted.
   */
  async confidentLang(orgId: number, customerText: string): Promise<string> {
    const text = customerText.trim();
    if (text === '') return '';
    const r = await this.toEnglish(orgId, text);
    const lang = r.lang ?? '';
    if (['', 'en', 'und', 'auto'].includes(lang)) return '';
    // eslint-disable-next-line no-control-regex
    if (!/^[\x00-\x7F]*$/.test(text)) return lang;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return norm(text) !== '' && norm(text) === norm(r.text) ? '' : lang;
  }

  /** An English bot message in the language the customer wrote in. English on any failure: it can never block an order. */
  async localize(orgId: number, message: string, customerText: string): Promise<string> {
    const m = message.trim();
    if (m === '' || customerText.trim() === '') return m;
    const lang = await this.confidentLang(orgId, customerText);
    return this.localizeTo(orgId, m, lang);
  }

  async localizeTo(orgId: number, message: string, lang: string | null): Promise<string> {
    const m = message.trim();
    if (m === '' || !lang || ['en', 'und', 'auto'].includes(lang)) return m;
    try {
      const out = await this.translation.translate(m, 'en', lang, { orgId });
      return out && out.trim() !== '' ? out : m;
    } catch {
      return m;
    }
  }

  private refused(reason: string): AppError {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, reason, HttpStatus.UNPROCESSABLE_ENTITY, [
      { path: 'reason', message: reason },
    ]);
  }
}

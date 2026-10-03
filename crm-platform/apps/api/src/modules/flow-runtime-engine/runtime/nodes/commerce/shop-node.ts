import { Injectable } from '@nestjs/common';
import type { ShopProduct } from '../../../graph/commerce-shapes';
import type { CustomDecision, InboundReply, NodeContext, NodeResult } from '../../types';
import { pickIndex, pickPrompt, preamble, productCaption } from './shop-rules';
import { FlowShopGate, type ShopProvider } from './shop-port';
import { obj, sendFailed, str } from './send-failure';

const HANDLER = 'CommerceShop';
const PURCHASED = 1;
const ABANDONED = 2;
const abandoned: NodeResult = { kind: 'advance', port: ABANDONED, branch: true };

/** What the node keeps while it waits. */
interface ShopWait {
  provider: ShopProvider;
  storeId: string;
  products: ShopProduct[];
  /** The products went out as the channel's own product list: the customer shops there, not by typing a number. */
  native: boolean;
  /** A checkout link was sent; later texts are not answered again. */
  linkSent: boolean;
}

/**
 * The Commerce shop node for WhatsApp Shop, WooCommerce and Shopify (TW-FLR-041). It offers the products the author picked, the ones in
 * stock now, and waits for the customer to buy: `purchased` (port 1) when the store reports an order that came from this run,
 * `abandoned` (port 2) when `abandonedWaitMinutes` pass without one, or when there is nothing to sell or no way to show it.
 *
 * Products go out as one card per product (an image with its name and price) and a prompt that asks for a number; a typed number
 * or part of a name picks one, and the customer is sent a single-use checkout link tagged with this run, so the order webhook can
 * find the run again (`FlowShopOrders`). WhatsApp Shop on the Cloud API sends the catalog's own product list instead, and the order
 * arrives as a WhatsApp order message (matched by the customer's number).
 *
 * The stock check, the native list and the checkout link come through the `FlowShopGate` port; see there for what is built.
 */
@Injectable()
export class ShopNode {
  constructor(private readonly shop: FlowShopGate) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    const provider = (str(p.provider) || 'woocommerce') as ShopProvider;
    const storeId = str(p.storeId);
    let products = (Array.isArray(p.products) ? p.products : []) as ShopProduct[];
    const header = ctx.render(str(p.headerText)).trim();
    const body = ctx.render(str(p.bodyText) || 'Tap a product to see details:').trim();
    const footer = ctx.render(str(p.footerText)).trim();
    const minutes = Math.max(1, Number(p.abandonedWaitMinutes) || 5);

    if (products.length === 0) {
      ctx.note('no products chosen: abandoned');
      return abandoned;
    }

    // Stock now. A store that cannot say offers everything, as Reference did when its stock check failed.
    try {
      const stock = await this.shop.inStock(ctx.run.orgId, {
        provider,
        storeId,
        retailerIds: products.map((x) => x.retailerId),
      });
      if (stock) products = products.filter((x) => stock.has(x.retailerId));
    } catch (err) {
      ctx.note(`stock check skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
    if (products.length === 0) {
      ctx.note('every product is out of stock: abandoned');
      return abandoned;
    }

    const wait = (native: boolean): NodeResult => ({
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: 'commerce_choice',
        kind: 'Custom',
        handler: HANDLER,
        data: { provider, storeId, products, native, linkSent: false } as unknown as Record<
          string,
          unknown
        >,
        timeoutSeconds: minutes * 60,
        timeoutPort: ABANDONED,
      },
    });

    // WhatsApp Shop on the Cloud API: the catalog's own product list, with the cart and checkout inside WhatsApp.
    if (provider === 'whatsapp_shop' && ctx.run.channelKind === 'whatsapp_cloud') {
      let sent = false;
      try {
        sent = await this.shop.sendNative(ctx.run.orgId, {
          provider,
          storeId,
          products,
          header,
          body,
          footer,
          peerKey: ctx.run.peerKey,
          runRef: ctx.run.uuid,
        });
      } catch (err) {
        ctx.note(
          `the product list could not be sent: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
      if (sent) return wait(true);
      ctx.note('no native product list here: sending the product cards');
    }

    // The card stack: a lead-in, one card per product, then the prompt.
    const lead = preamble(header, body);
    if (lead !== '') {
      const out = await ctx.send({ kind: 'text', body: lead });
      if (!out.ok) {
        const stop = sendFailed(out, 'skip', ctx);
        if (stop) return stop;
      }
    }
    for (let i = 0; i < products.length; i++) {
      const prod = products[i]!;
      const caption = productCaption(i + 1, prod);
      const out = await ctx.send(
        prod.image
          ? { kind: 'media', mediaKind: 'image', url: prod.image, caption }
          : { kind: 'text', body: caption },
      );
      if (!out.ok) {
        const stop = sendFailed(out, 'skip', ctx);
        if (stop) return stop;
      }
    }
    const prompt = await ctx.send({ kind: 'text', body: pickPrompt(products, footer) });
    if (!prompt.ok) return sendFailed(prompt, 'end', ctx)!;
    return wait(false);
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    const w = ctx.run.wait?.data as unknown as ShopWait | undefined;
    if (!w) return { action: 'ignore' };

    // The store reported an order from this run (or the customer's catalog cart arrived): bought.
    if (reply.kind === 'external') {
      const o = obj(reply.data?.order);
      return {
        action: 'route',
        port: PURCHASED,
        setVars: {
          order_id: str(o.id),
          order_total: str(o.total),
          order_currency: str(o.currency),
        },
      };
    }

    // Typing is not how a native list is used, and once a link is out the customer's chat is not answered again.
    if (w.native || w.linkSent || (reply.kind !== 'text' && reply.kind !== 'tap')) {
      return { action: 'ignore' };
    }
    const text = reply.text.trim();
    if (text === '') return { action: 'ignore' };

    const idx = pickIndex(text, w.products);
    if (idx < 0) {
      await ctx.send({
        kind: 'text',
        body: `Sorry, I didn't catch that. Reply with a number from 1 to ${w.products.length}.`,
      });
      return { action: 'ignore' };
    }
    const picked = w.products[idx]!;
    const setVars = { commerce_choice: picked.retailerId };

    let url: string | null = null;
    try {
      url = await this.shop.checkoutLink(ctx.run.orgId, {
        provider: w.provider,
        storeId: w.storeId,
        retailerId: picked.retailerId,
        qty: 1,
        runRef: ctx.run.uuid,
        phone: ctx.run.peerKey,
      });
    } catch (err) {
      ctx.note(`checkout link failed: ${err instanceof Error ? err.message : 'error'}`);
    }
    if (!url) {
      await ctx.send({
        kind: 'text',
        body: "Sorry, couldn't generate a checkout link right now. Please try again in a moment.",
      });
      // The wait goes on: the customer may try again, and the abandon time still runs.
      return { action: 'stay', setVars, data: { ...w } as unknown as Record<string, unknown> };
    }
    await ctx.send({
      kind: 'text',
      body: `Thanks! Complete your order here:\n${url}\n\nThis link is single-use.`,
    });
    return {
      action: 'stay',
      setVars,
      data: { ...w, linkSent: true } as unknown as Record<string, unknown>,
    };
  }
}

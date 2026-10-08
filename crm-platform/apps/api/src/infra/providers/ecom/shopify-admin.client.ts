import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_PAGES,
  SHOP_DOMAIN,
  type EcomResult,
  type CheckoutLine,
  type ShopInfo,
  type StoreCounts,
  type StoreRead,
  type StoreRecord,
  type ShopifyAppApi,
  type ShopifyCheckoutApi,
  type ShopifyFactory,
  type ShopifySettings,
  type ShopifyStoreApi,
} from './ecom.port';

/** The current stable REST Admin API version; Shopify ships a new one each quarter and keeps the old one for a year. */
export const SHOPIFY_API_VERSION = '2026-04';
const TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const text = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;

/** The address of the next page from a `Link` header (`<...>; rel="next"`), or null on the last page. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (m) return m[1]!;
  }
  return null;
}

/** One request. Never throws: a network failure is `null`. The token goes in a header, never in the address or a log. */
async function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  o: { token?: string; storefrontToken?: string; json?: Json } = {},
): Promise<{ status: number; json: Json; next: string | null } | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.token) headers['X-Shopify-Access-Token'] = o.token;
  if (o.storefrontToken) headers['X-Shopify-Storefront-Access-Token'] = o.storefrontToken;
  if (o.json) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: o.json ? JSON.stringify(o.json) : undefined,
      // A Shopify host is fixed and validated; a redirect somewhere else is never followed.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      status: res.status,
      json: obj(await res.json().catch(() => ({}))),
      next: nextLink(res.headers.get('link')),
    };
  } catch {
    return null;
  }
}

const adminBase = (shop: string) => `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;

class ShopifyApp implements ShopifyAppApi {
  constructor(private readonly s: ShopifySettings) {}

  async exchangeCode(
    shop: string,
    code: string,
  ): Promise<EcomResult<{ accessToken: string; scope: string }>> {
    if (!SHOP_DOMAIN.test(shop)) return { ok: false, error: 'Not a Shopify store address.' };
    const r = await call('POST', `https://${shop}/admin/oauth/access_token`, {
      json: { client_id: this.s.clientId, client_secret: this.s.clientSecret, code },
    });
    if (!r) return { ok: false, error: 'Shopify did not answer.' };
    const token = text(r.json.access_token);
    if (r.status >= 200 && r.status < 300 && token) {
      return { ok: true, data: { accessToken: token, scope: text(r.json.scope) ?? '' } };
    }
    return {
      ok: false,
      error: text(r.json.error_description) ?? text(r.json.error) ?? `HTTP ${r.status}`,
    };
  }
}

class ShopifyStore implements ShopifyStoreApi {
  private readonly logger = new Logger('ShopifyStore');

  constructor(
    private readonly shopDomain: string,
    private readonly token: string,
  ) {}

  async shop(): Promise<EcomResult<ShopInfo>> {
    if (!SHOP_DOMAIN.test(this.shopDomain))
      return { ok: false, error: 'Not a Shopify store address.' };
    const r = await call('GET', `${adminBase(this.shopDomain)}/shop.json`, { token: this.token });
    if (!r) return { ok: false, error: 'Shopify did not answer.' };
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `HTTP ${r.status}` };
    const s = obj(r.json.shop);
    return {
      ok: true,
      data: {
        id: text(s.id),
        name: text(s.name),
        email: text(s.email),
        owner: text(s.shop_owner),
        plan: text(s.plan_name),
        currency: text(s.currency),
        country: text(s.country_name),
      },
    };
  }

  async counts(): Promise<StoreCounts> {
    const out: StoreCounts = { products: 0, orders: 0, customers: 0 };
    if (!SHOP_DOMAIN.test(this.shopDomain)) return out;
    const paths = {
      products: 'products/count.json',
      // `orders/count.json` needs an explicit status; the others do not.
      orders: 'orders/count.json?status=any',
      customers: 'customers/count.json',
    } as const;
    for (const [k, path] of Object.entries(paths) as Array<[keyof StoreCounts, string]>) {
      const r = await call('GET', `${adminBase(this.shopDomain)}/${path}`, { token: this.token });
      const n = r && r.status >= 200 && r.status < 300 ? Number(r.json.count) : 0;
      out[k] = Number.isFinite(n) ? n : 0;
    }
    return out;
  }

  /**
   * Reads one list to the end of its pages. Shopify pages by cursor: each answer's `Link` header names the next page, which must be
   * on the same store (a header pointing anywhere else is not followed).
   */
  private async readAll(resource: string, key: string, query: string): Promise<StoreRead> {
    const items: StoreRecord[] = [];
    if (!SHOP_DOMAIN.test(this.shopDomain)) return { items, complete: false };
    let url: string | null = `${adminBase(this.shopDomain)}/${resource}.json?${query}`;
    for (let page = 0; url !== null; page += 1) {
      if (page >= MAX_PAGES) return { items, complete: false };
      const r = await call('GET', url, { token: this.token });
      if (!r || r.status < 200 || r.status >= 300) return { items, complete: false };
      const list = r.json[key];
      if (Array.isArray(list)) for (const x of list) items.push(obj(x));
      url = r.next !== null && new URL(r.next).host === this.shopDomain ? r.next : null;
    }
    return { items, complete: true };
  }

  products(): Promise<StoreRead> {
    return this.readAll(
      'products',
      'products',
      'limit=250&fields=id,title,handle,body_html,tags,vendor,product_type,status,images,image,variants,created_at',
    );
  }

  orders(): Promise<StoreRead> {
    return this.readAll(
      'orders',
      'orders',
      'limit=250&status=any&fields=id,name,order_number,email,phone,created_at,cancelled_at,total_price,currency,financial_status,fulfillment_status,line_items,customer,shipping_address,billing_address,payment_gateway_names,gateway,tags',
    );
  }

  customers(): Promise<StoreRead> {
    return this.readAll(
      'customers',
      'customers',
      'limit=250&fields=id,first_name,last_name,email,phone,orders_count,total_spent,created_at',
    );
  }

  async registerWebhooks(
    address: string,
    topics: readonly string[],
  ): Promise<Record<string, string>> {
    if (!SHOP_DOMAIN.test(this.shopDomain)) return {};
    const done: Record<string, string> = {};
    for (const topic of topics) {
      const r = await call('POST', `${adminBase(this.shopDomain)}/webhooks.json`, {
        token: this.token,
        json: { webhook: { topic, address, format: 'json' } },
      });
      const id = text(obj(r?.json.webhook).id);
      if (r && r.status >= 200 && r.status < 300 && id) done[topic] = id;
      else this.logger.warn({ topic, status: r?.status ?? null }, 'shopify webhook not registered');
    }
    return done;
  }

  async deleteWebhooks(ids: readonly string[]): Promise<void> {
    if (!SHOP_DOMAIN.test(this.shopDomain)) return;
    for (const id of ids) {
      if (!id) continue;
      await call(
        'DELETE',
        `${adminBase(this.shopDomain)}/webhooks/${encodeURIComponent(id)}.json`,
        {
          token: this.token,
        },
      );
    }
  }
}

const variantGid = (id: string): string => `gid://shopify/ProductVariant/${id}`;

/** The checkout calls of a flow's shop node (WD-ECOM-036). Every address is built on the validated shop host. */
class ShopifyCheckout implements ShopifyCheckoutApi {
  constructor(
    private readonly shopDomain: string,
    private readonly token: string,
  ) {}

  private get ok(): boolean {
    return SHOP_DOMAIN.test(this.shopDomain);
  }

  async variantIdBySku(sku: string): Promise<string | null> {
    const clean = sku.replace(/["\\]/g, '').trim();
    if (!this.ok || clean === '') return null;
    const r = await call('POST', `${adminBase(this.shopDomain)}/graphql.json`, {
      token: this.token,
      json: {
        query: 'query($q: String!) { productVariants(first: 1, query: $q) { nodes { id sku } } }',
        variables: { q: `sku:"${clean}"` },
      },
    });
    if (!r || r.status < 200 || r.status >= 300) return null;
    const nodes = obj(obj(r.json.data).productVariants).nodes;
    const first = Array.isArray(nodes) ? obj(nodes[0]) : {};
    // The search is a prefix match on some stores: only the exact sku counts.
    if (text(first.sku) !== clean) return null;
    const m = /(\d+)$/.exec(text(first.id) ?? '');
    return m ? m[1]! : null;
  }

  async firstVariantId(productId: string): Promise<string | null> {
    if (!this.ok || !/^\d+$/.test(productId)) return null;
    const r = await call(
      'GET',
      `${adminBase(this.shopDomain)}/products/${productId}.json?fields=id,variants`,
      { token: this.token },
    );
    if (!r || r.status < 200 || r.status >= 300) return null;
    const variants = obj(r.json.product).variants;
    return Array.isArray(variants) ? text(obj(variants[0]).id) : null;
  }

  async createStorefrontCart(
    storefrontToken: string,
    lines: readonly CheckoutLine[],
    note: string | null,
  ): Promise<{ url: string; cartId: string | null } | null> {
    if (!this.ok || storefrontToken === '' || lines.length === 0) return null;
    // A note is only attached when there is one: a null would land in the order as the word "null" and break the order's lookup.
    const input: Json = {
      lines: lines.map((l) => ({
        merchandiseId: variantGid(l.variantId),
        quantity: Math.max(1, l.qty),
      })),
      ...(note ? { note } : {}),
    };
    const r = await call(
      'POST',
      `https://${this.shopDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        storefrontToken,
        json: {
          query:
            'mutation($input: CartInput!) { cartCreate(input: $input) { cart { id checkoutUrl } userErrors { message } } }',
          variables: { input },
        },
      },
    );
    if (!r || r.status < 200 || r.status >= 300) return null;
    const cart = obj(obj(obj(r.json.data).cartCreate).cart);
    const url = text(cart.checkoutUrl);
    return url ? { url, cartId: text(cart.id) } : null;
  }

  async createDraftOrder(
    lines: readonly CheckoutLine[],
    note: string | null,
  ): Promise<{ url: string; draftId: string | null } | null> {
    if (!this.ok || lines.length === 0) return null;
    const r = await call('POST', `${adminBase(this.shopDomain)}/draft_orders.json`, {
      token: this.token,
      json: {
        draft_order: {
          line_items: lines.map((l) => ({
            variant_id: Number(l.variantId),
            quantity: Math.max(1, l.qty),
          })),
          tags: 'wadesk-flow',
          ...(note ? { note } : {}),
        },
      },
    });
    if (!r || r.status < 200 || r.status >= 300) return null;
    const draft = obj(r.json.draft_order);
    const url = text(draft.invoice_url);
    return url ? { url, draftId: text(draft.id) } : null;
  }
}

@Injectable()
export class HttpShopifyFactory implements ShopifyFactory {
  app(settings: ShopifySettings): ShopifyAppApi {
    return new ShopifyApp(settings);
  }

  store(shop: string, accessToken: string): ShopifyStoreApi {
    return new ShopifyStore(shop, accessToken);
  }

  checkout(shop: string, accessToken: string): ShopifyCheckoutApi {
    return new ShopifyCheckout(shop, accessToken);
  }
}

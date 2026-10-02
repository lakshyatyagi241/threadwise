import { Injectable, Logger } from '@nestjs/common';
import {
  SHOP_DOMAIN,
  type EcomResult,
  type ShopInfo,
  type ShopifyAppApi,
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

/** One request. Never throws: a network failure is `null`. The token goes in a header, never in the address or a log. */
async function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  o: { token?: string; json?: Json } = {},
): Promise<{ status: number; json: Json } | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.token) headers['X-Shopify-Access-Token'] = o.token;
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
    return { status: res.status, json: obj(await res.json().catch(() => ({}))) };
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

@Injectable()
export class HttpShopifyFactory implements ShopifyFactory {
  app(settings: ShopifySettings): ShopifyAppApi {
    return new ShopifyApp(settings);
  }

  store(shop: string, accessToken: string): ShopifyStoreApi {
    return new ShopifyStore(shop, accessToken);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ecomConfig } from '../../../config/domains/ecom.env';
import { guardedRequest } from '../../net/guarded-http';
import {
  MAX_PAGES,
  type EcomResult,
  type StoreCounts,
  type StoreRead,
  type StoreRecord,
  type WooFactory,
  type WooStoreApi,
  type WooStoreInfo,
} from './ecom.port';

const API_PATH = '/wp-json/wc/v3';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const text = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;

class WooStore implements WooStoreApi {
  private readonly logger = new Logger('WooStore');
  private readonly auth: string;

  constructor(
    private readonly storeUrl: string,
    consumerKey: string,
    consumerSecret: string,
  ) {
    // HTTP Basic with the consumer key and secret, as WooCommerce documents for HTTPS stores (no OAuth1 fallback).
    this.auth = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
  }

  /** One request to the store. Private addresses are refused unless the install allows them. Never throws. */
  private async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    json?: Json,
  ): Promise<
    | { status: number; json: unknown; raw: string; total: number | null; pages: number | null }
    | { error: string }
  > {
    let url: URL;
    try {
      url = new URL(`${this.storeUrl.replace(/\/+$/, '')}${API_PATH}${path}`);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme');
    } catch {
      return { error: 'Not a valid store address.' };
    }
    try {
      const res = await guardedRequest({
        method,
        url,
        headers: { Accept: 'application/json', Authorization: this.auth },
        body: json === undefined ? undefined : JSON.stringify(json),
        timeoutMs: TIMEOUT_MS,
        allowPrivate: ecomConfig().ECOM_ALLOW_PRIVATE_STORE_URLS,
        maxBytes: MAX_BYTES,
      });
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        parsed = null;
      }
      const header = (name: string) => {
        const v = Number(res.headers[name]);
        return Number.isFinite(v) ? v : null;
      };
      return {
        status: res.status,
        json: parsed,
        raw: res.body.slice(0, 200),
        total: header('x-wp-total'),
        pages: header('x-wp-totalpages'),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async test(): Promise<EcomResult<WooStoreInfo>> {
    const r = await this.send('GET', '/system_status');
    if ('error' in r) return { ok: false, error: r.error };
    const body = obj(r.json);
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, error: `HTTP ${r.status}: ${text(body.message) ?? r.raw}` };
    }
    const env = obj(body.environment);
    const settings = obj(body.settings);
    // `site_title` is not in every version's environment: fall back to the host of `home_url` so the store always has a label.
    let host: string | null = null;
    try {
      host = new URL(text(env.home_url) ?? '').hostname || null;
    } catch {
      host = null;
    }
    return {
      ok: true,
      data: {
        name: text(env.site_title) ?? host,
        currency: text(settings.currency),
        country: text(env.default_country),
        version: text(env.version),
      },
    };
  }

  /** WooCommerce has no count endpoint: the total comes back in the `X-WP-Total` header of a one-row page. */
  async counts(): Promise<StoreCounts> {
    const out: StoreCounts = { products: 0, orders: 0, customers: 0 };
    for (const k of Object.keys(out) as Array<keyof StoreCounts>) {
      const r = await this.send('GET', `/${k}?per_page=1`);
      if (!('error' in r) && r.status >= 200 && r.status < 300) out[k] = r.total ?? 0;
    }
    return out;
  }

  /** Reads one list page by page (100 a page) until a short page, the last page the store reports, or the page cap. */
  private async readAll(path: string, orderby: string): Promise<StoreRead> {
    const items: StoreRecord[] = [];
    for (let page = 1; ; page += 1) {
      if (page > MAX_PAGES) return { items, complete: false };
      const r = await this.send(
        'GET',
        `${path}?per_page=100&orderby=${orderby}&order=desc&page=${page}`,
      );
      if ('error' in r || r.status < 200 || r.status >= 300 || !Array.isArray(r.json)) {
        return { items, complete: false };
      }
      for (const x of r.json) items.push(obj(x));
      if (r.json.length < 100 || (r.pages !== null && page >= r.pages))
        return { items, complete: true };
    }
  }

  products(): Promise<StoreRead> {
    return this.readAll('/products', 'date');
  }

  orders(): Promise<StoreRead> {
    return this.readAll('/orders', 'date');
  }

  customers(): Promise<StoreRead> {
    return this.readAll('/customers', 'registered_date');
  }

  async registerWebhooks(a: {
    deliveryUrl: string;
    secret: string;
    topics: readonly string[];
    nameOf: (topic: string) => string;
  }): Promise<Record<string, string>> {
    const done: Record<string, string> = {};
    for (const topic of a.topics) {
      const r = await this.send('POST', '/webhooks', {
        name: a.nameOf(topic),
        topic,
        delivery_url: a.deliveryUrl,
        secret: a.secret,
        status: 'active',
      });
      const id = 'error' in r ? null : text(obj(r.json).id);
      if (!('error' in r) && r.status >= 200 && r.status < 300 && id) done[topic] = id;
      else this.logger.warn({ topic }, 'woocommerce webhook not registered');
    }
    return done;
  }

  async updateOrder(orderId: string, patch: Json): Promise<boolean> {
    const r = await this.send('PUT', `/orders/${encodeURIComponent(orderId)}`, patch);
    return !('error' in r) && r.status >= 200 && r.status < 300;
  }

  async createPendingOrder(
    items: ReadonlyArray<{ reference: string; qty: number }>,
    flowSessionId: string | null,
  ): Promise<{ url: string; orderId: string } | null> {
    // WooCommerce accepts a product id or a sku per line; a reference that is only digits is the id.
    const line_items = items.map((i) => ({
      quantity: Math.max(1, i.qty),
      ...(/^\d+$/.test(i.reference) ? { product_id: Number(i.reference) } : { sku: i.reference }),
    }));
    const meta_data = [
      ...(flowSessionId ? [{ key: '_wa_flow_session', value: flowSessionId }] : []),
      { key: '_wa_origin', value: 'threadwise-flow' },
    ];
    const r = await this.send('POST', '/orders', { status: 'pending', line_items, meta_data });
    if ('error' in r || r.status < 200 || r.status >= 300) return null;
    const order = obj(r.json);
    const id = text(order.id);
    let url = text(order.payment_url) ?? '';
    if (url === '') {
      // Older WooCommerce versions send no payment_url: build it from the order key.
      const key = text(order.order_key);
      if (id && key)
        url = `${this.storeUrl.replace(/\/+$/, '')}/checkout/order-pay/${id}/?pay_for_order=true&key=${key}`;
    }
    return url !== '' && id ? { url, orderId: id } : null;
  }

  async deleteWebhooks(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      if (!id) continue;
      await this.send('DELETE', `/webhooks/${encodeURIComponent(id)}?force=true`);
    }
  }
}

@Injectable()
export class HttpWooFactory implements WooFactory {
  store(storeUrl: string, consumerKey: string, consumerSecret: string): WooStoreApi {
    return new WooStore(storeUrl, consumerKey, consumerSecret);
  }
}

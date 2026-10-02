import { Injectable, Logger } from '@nestjs/common';
import { ecomConfig } from '../../../config/domains/ecom.env';
import { guardedRequest } from '../../net/guarded-http';
import type { EcomResult, WooFactory, WooStoreApi, WooStoreInfo } from './ecom.port';

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
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    json?: Json,
  ): Promise<{ status: number; json: unknown; raw: string } | { error: string }> {
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
      return { status: res.status, json: parsed, raw: res.body.slice(0, 200) };
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

import { Logger } from '@nestjs/common';
import {
  CatalogProviderError,
  type CatalogBatchItem,
  type CatalogBatchStatus,
  type CatalogBinding,
  type CatalogInfo,
  type CatalogProvider,
  type GraphAuth,
  type MetaCatalogProduct,
  type MpmSection,
  type SentMessage,
} from './catalog-provider.port';

export const DIALOG_360_HOST = 'https://waba-v2.360dialog.io';
const GRAPH_HOST = 'https://graph.facebook.com';
const CALL_TIMEOUT_MS = 30_000;
const AUTODETECT_TIMEOUT_MS = 12_000;
const NAME_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 250;
const LIST_PAGE = 200;
const LIST_MAX_PAGES = 50;

export interface MetaGraphOptions {
  /**
   * `v23.0` by default (Reference's `catalog_graph_api_version`). A function is asked on every call, so an operator's change of the
   * saved setting applies to the next request without a restart.
   */
  graphVersion: string | (() => string | Promise<string>);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  dialogHost?: string;
}

interface Call {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  query?: Record<string, string | number>;
  body?: unknown;
  op: string;
  timeoutMs: number;
  /** Safe to send twice: a GET, or an upsert keyed on the retailer id. A message send is never retried. */
  retry: boolean;
  secrets: readonly string[];
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Removes the token (and its base64 form) from text that may be shown to an operator or logged. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length < 4) continue;
    out = out.split(s).join('***');
    out = out.split(Buffer.from(s).toString('base64')).join('***');
  }
  return out;
}

/**
 * The live adapter: Meta's Graph API and 360dialog over `fetch`, with a timeout on every call, one retry for safe calls and
 * Meta's error envelope turned into a typed error. Nothing here can be exercised against the real services from a test run
 * (no Meta app, no 360dialog key); the unit tests drive it with recorded Graph responses through a mocked `fetch`.
 */
export class MetaGraphCatalogProvider implements CatalogProvider {
  private readonly logger = new Logger('MetaGraphCatalogProvider');
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly dialogHost: string;

  constructor(private readonly opts: MetaGraphOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
    this.dialogHost = (opts.dialogHost ?? DIALOG_360_HOST).replace(/\/+$/, '');
  }

  // --- plumbing -----------------------------------------------------------------------------------------------------------

  private async graph(path: string): Promise<string> {
    const raw =
      typeof this.opts.graphVersion === 'function'
        ? await this.opts.graphVersion()
        : this.opts.graphVersion;
    const version = raw.replace(/^\/+/, '');
    return `${GRAPH_HOST}/${version}/${path.replace(/^\/+/, '')}`;
  }

  /** 360dialog authenticates with its own header; Meta Cloud with a bearer token. */
  private auth(b: Pick<CatalogBinding, 'provider' | 'accessToken'>): Record<string, string> {
    return b.provider === 'dialog_360'
      ? { 'D360-API-KEY': b.accessToken }
      : { Authorization: `Bearer ${b.accessToken}` };
  }

  /** Where `/messages` and `/whatsapp_commerce_settings` live. Meta needs the phone number id in the path, 360dialog does not. */
  private async messagesBase(b: CatalogBinding): Promise<string> {
    if (b.provider === 'dialog_360') return this.dialogHost;
    if (!b.phoneNumberId) {
      throw new CatalogProviderError(
        'Catalog has no phone_number_id: Meta Cloud requires it on the /messages path.',
        'config',
      );
    }
    return this.graph(b.phoneNumberId);
  }

  private async call(c: Call): Promise<Record<string, unknown>> {
    const qs = c.query
      ? `?${new URLSearchParams(Object.entries(c.query).map(([k, v]): [string, string] => [k, String(v)])).toString()}`
      : '';
    const attempts = c.retry ? 2 : 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(`${c.url}${qs}`, {
          method: c.method,
          headers: {
            Accept: 'application/json',
            ...(c.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...c.headers,
          },
          body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
          signal: AbortSignal.timeout(c.timeoutMs),
        });
        const text = await res.text();
        let json: Record<string, unknown> = {};
        try {
          json = asRecord(text ? JSON.parse(text) : {});
        } catch {
          json = {};
        }
        if (res.ok) return json;
        // A 5xx may be transient; a 4xx is Meta's verdict on the request and is returned as is.
        if (res.status >= 500 && attempt < attempts) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
          continue;
        }
        throw this.decodeFailure(res.status, json, c);
      } catch (err) {
        if (err instanceof CatalogProviderError) throw err;
        last = err;
        if (attempt < attempts) await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }
    const reason = last instanceof Error ? last.message : 'request failed';
    throw new CatalogProviderError(
      scrub(`Could not reach the provider (${c.op}): ${reason}`, c.secrets),
      'network',
    );
  }

  /** Meta's `error` envelope: message, code and subcode; the full body is logged (without the token), never returned. */
  private decodeFailure(
    status: number,
    json: Record<string, unknown>,
    c: Call,
  ): CatalogProviderError {
    const env = asRecord(json.error);
    const raw = typeof env.message === 'string' && env.message ? env.message : null;
    const code = typeof env.code === 'number' ? env.code : status;
    const subcode = typeof env.error_subcode === 'number' ? env.error_subcode : null;
    const message = scrub(raw ?? `HTTP ${status}: ${c.op}`, c.secrets);
    this.logger.warn(
      scrub(JSON.stringify({ op: c.op, status, code, subcode, message: raw }), c.secrets),
    );
    return new CatalogProviderError(message, 'meta', {
      code,
      subcode,
      httpStatus: status,
      raw: raw ? scrub(raw, c.secrets) : null,
    });
  }

  private base(b: CatalogBinding, op: string, over: Partial<Call>): Call {
    return {
      method: 'GET',
      url: '',
      headers: this.auth(b),
      op,
      timeoutMs: this.timeoutMs,
      retry: false,
      secrets: [b.accessToken],
      ...over,
    };
  }

  // --- catalog ------------------------------------------------------------------------------------------------------------

  async verifyCatalog(b: CatalogBinding): Promise<CatalogInfo> {
    const json = await this.call(
      this.base(b, 'verifyCatalog', {
        url: await this.graph(b.catalogId),
        query: { fields: 'id,name,product_count,vertical,is_catalog_segment' },
        retry: true,
      }),
    );
    return {
      id: String(json.id ?? b.catalogId),
      name: typeof json.name === 'string' ? json.name : null,
      productCount: typeof json.product_count === 'number' ? json.product_count : null,
    };
  }

  async listProducts(b: CatalogBinding, max = 2000): Promise<MetaCatalogProduct[]> {
    const out: MetaCatalogProduct[] = [];
    let after: string | null = null;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
      const json = await this.call(
        this.base(b, 'listProducts', {
          url: await this.graph(`${b.catalogId}/products`),
          query: {
            fields: 'id,retailer_id,name,description,price,currency,availability,image_url,url',
            limit: LIST_PAGE,
            ...(after ? { after } : {}),
          },
          retry: true,
        }),
      );
      const data = Array.isArray(json.data) ? json.data : [];
      for (const raw of data) {
        const p = asRecord(raw);
        out.push({
          metaId: String(p.id ?? ''),
          retailerId: String(p.retailer_id ?? ''),
          name: String(p.name ?? ''),
          description: p.description != null ? String(p.description) : null,
          price:
            typeof p.price === 'number' || typeof p.price === 'string'
              ? (p.price as number | string)
              : null,
          currency: p.currency != null ? String(p.currency) : null,
          availability: p.availability != null ? String(p.availability) : null,
          imageUrl: p.image_url != null ? String(p.image_url) : null,
          url: p.url != null ? String(p.url) : null,
        });
        if (out.length >= max) return out;
      }
      const paging = asRecord(json.paging);
      const cursors = asRecord(paging.cursors);
      after = typeof cursors.after === 'string' && cursors.after ? cursors.after : null;
      if (!paging.next || !after) break;
    }
    return out;
  }

  async upsertProductsBatch(
    b: CatalogBinding,
    items: readonly CatalogBatchItem[],
  ): Promise<string[]> {
    if (items.length === 0) return [];
    const json = await this.call(
      this.base(b, 'upsertProductsBatch', {
        method: 'POST',
        url: await this.graph(`${b.catalogId}/items_batch`),
        body: {
          item_type: 'PRODUCT_ITEM',
          requests: items.map((i) => ({
            method: 'CREATE',
            retailer_id: i.retailerId,
            data: i.data,
          })),
        },
        // CREATE is an upsert on the retailer id, so a repeat of the same batch changes nothing.
        retry: true,
      }),
    );
    return (Array.isArray(json.handles) ? json.handles : []).map((h) => String(h));
  }

  async checkBatchStatus(
    b: CatalogBinding,
    handles: readonly string[],
  ): Promise<CatalogBatchStatus[]> {
    if (handles.length === 0) return [];
    const json = await this.call(
      this.base(b, 'checkBatchStatus', {
        url: await this.graph(`${b.catalogId}/check_batch_request_status`),
        query: { handles: JSON.stringify([...handles]) },
        retry: true,
      }),
    );
    return (Array.isArray(json.data) ? json.data : []).map((raw) => {
      const r = asRecord(raw);
      const errors = (Array.isArray(r.errors) ? r.errors : []).map((e) => ({
        message: String(asRecord(e).message ?? ''),
      }));
      return { handle: String(r.handle ?? ''), status: String(r.status ?? ''), errors };
    });
  }

  async setCommerceSettings(
    b: CatalogBinding,
    settings: { catalogVisible: boolean; cartEnabled: boolean },
  ): Promise<void> {
    if (!b.phoneNumberId) {
      throw new CatalogProviderError(
        'Catalog has no phone_number_id bound: set commerce settings against a specific phone number.',
        'config',
      );
    }
    await this.call(
      this.base(b, 'setCommerceSettings', {
        method: 'POST',
        url: `${await this.messagesBase(b)}/whatsapp_commerce_settings`,
        body: {
          is_cart_enabled: settings.cartEnabled,
          is_catalog_visible: settings.catalogVisible,
        },
      }),
    );
  }

  // --- messages -----------------------------------------------------------------------------------------------------------

  private async send(b: CatalogBinding, op: string, payload: unknown): Promise<SentMessage> {
    const json = await this.call(
      this.base(b, op, {
        method: 'POST',
        url: `${await this.messagesBase(b)}/messages`,
        body: payload,
      }),
    );
    const first = asRecord(Array.isArray(json.messages) ? json.messages[0] : undefined);
    return { messageId: typeof first.id === 'string' ? first.id : null, raw: json };
  }

  private envelope(to: string, type: string, rest: Record<string, unknown>) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      ...rest,
    };
  }

  sendSPM(
    b: CatalogBinding,
    to: string,
    retailerId: string,
    body: string | null,
    footer: string | null,
  ): Promise<SentMessage> {
    return this.send(
      b,
      'sendSPM',
      this.envelope(to, 'interactive', {
        interactive: {
          type: 'product',
          ...(body ? { body: { text: trim(body, 1024) } } : {}),
          ...(footer ? { footer: { text: trim(footer, 60) } } : {}),
          action: { catalog_id: b.catalogId, product_retailer_id: retailerId },
        },
      }),
    );
  }

  /** Meta's caps are enforced here so a long list fails nowhere with a cryptic Meta error: 30 products over at most 10 sections, titles to 24 characters. */
  sendMPM(
    b: CatalogBinding,
    to: string,
    header: string,
    body: string,
    sections: readonly MpmSection[],
    footer: string | null,
  ): Promise<SentMessage> {
    let total = 0;
    const clean: Array<{ title: string; product_items: Array<{ product_retailer_id: string }> }> =
      [];
    outer: for (const s of sections.slice(0, 10)) {
      const items: Array<{ product_retailer_id: string }> = [];
      for (const rid of s.productRetailerIds) {
        if (total >= 30) {
          if (items.length > 0) clean.push({ title: trim(s.title, 24), product_items: items });
          break outer;
        }
        items.push({ product_retailer_id: rid });
        total++;
      }
      if (items.length > 0) clean.push({ title: trim(s.title, 24), product_items: items });
    }
    return this.send(
      b,
      'sendMPM',
      this.envelope(to, 'interactive', {
        interactive: {
          type: 'product_list',
          header: { type: 'text', text: trim(header, 60) },
          body: { text: trim(body, 1024) },
          ...(footer ? { footer: { text: trim(footer, 60) } } : {}),
          action: { catalog_id: b.catalogId, sections: clean },
        },
      }),
    );
  }

  sendCatalogMessage(
    b: CatalogBinding,
    to: string,
    body: string,
    thumbnailRetailerId: string,
    footer: string | null,
  ): Promise<SentMessage> {
    return this.send(
      b,
      'sendCatalogMessage',
      this.envelope(to, 'interactive', {
        interactive: {
          type: 'catalog_message',
          body: { text: trim(body, 1024) },
          ...(footer ? { footer: { text: trim(footer, 60) } } : {}),
          action: {
            name: 'catalog_message',
            parameters: { thumbnail_product_retailer_id: thumbnailRetailerId },
          },
        },
      }),
    );
  }

  /** Plain text with a link preview: Meta recognises the `wa.me/c/...` URL and draws the catalog card on the phone. */
  sendCatalogLink(b: CatalogBinding, to: string, body: string): Promise<SentMessage> {
    return this.send(
      b,
      'sendCatalogLink',
      this.envelope(to, 'text', { text: { body, preview_url: true } }),
    );
  }

  sendText(b: CatalogBinding, to: string, body: string): Promise<SentMessage> {
    return this.send(
      b,
      'sendText',
      this.envelope(to, 'text', { text: { body, preview_url: false } }),
    );
  }

  // --- autodetect ---------------------------------------------------------------------------------------------------------

  private authCall(a: GraphAuth, op: string, over: Partial<Call>): Call {
    return {
      method: 'GET',
      url: '',
      headers: { Authorization: `Bearer ${a.accessToken}` },
      op,
      timeoutMs: AUTODETECT_TIMEOUT_MS,
      retry: false,
      secrets: [a.accessToken],
      ...over,
    };
  }

  async listWabaCatalogs(a: GraphAuth, wabaId: string): Promise<string[]> {
    const json = await this.call(
      this.authCall(a, 'listWabaCatalogs', { url: await this.graph(`${wabaId}/product_catalogs`) }),
    );
    return (Array.isArray(json.data) ? json.data : [])
      .map((d) => asRecord(d).id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
  }

  async createCatalog(a: GraphAuth, businessId: string, name: string): Promise<string | null> {
    const json = await this.call(
      this.authCall(a, 'createCatalog', {
        method: 'POST',
        url: await this.graph(`${businessId}/owned_product_catalogs`),
        body: { name, vertical: 'commerce' },
      }),
    );
    return typeof json.id === 'string' && json.id ? json.id : null;
  }

  async linkCatalogToWaba(a: GraphAuth, wabaId: string, catalogId: string): Promise<void> {
    await this.call(
      this.authCall(a, 'linkCatalogToWaba', {
        method: 'POST',
        url: await this.graph(`${wabaId}/product_catalogs`),
        body: { catalog_id: catalogId },
      }),
    );
  }

  async catalogName(a: GraphAuth, catalogId: string): Promise<string | null> {
    const json = await this.call(
      this.authCall(a, 'catalogName', {
        url: await this.graph(catalogId),
        query: { fields: 'name' },
        timeoutMs: NAME_TIMEOUT_MS,
      }),
    );
    return typeof json.name === 'string' && json.name ? json.name : null;
  }

  // --- manage (rename, delete, product sets) ------------------------------------------------------------------------------

  async renameCatalog(b: CatalogBinding, name: string): Promise<void> {
    await this.call(
      this.base(b, 'renameCatalog', {
        method: 'POST',
        url: await this.graph(b.catalogId),
        body: { name },
      }),
    );
  }

  async deleteCatalog(b: CatalogBinding): Promise<void> {
    await this.call(
      this.base(b, 'deleteCatalog', { method: 'DELETE', url: await this.graph(b.catalogId) }),
    );
  }

  /** A product set is the products whose retailer id is in the list. */
  private setFilter(retailerIds: readonly string[]): string {
    return JSON.stringify({ retailer_id: { is_any: retailerIds } });
  }

  async createProductSet(
    b: CatalogBinding,
    name: string,
    retailerIds: readonly string[],
  ): Promise<string> {
    const json = await this.call(
      this.base(b, 'createProductSet', {
        method: 'POST',
        url: await this.graph(`${b.catalogId}/product_sets`),
        body: { name, filter: this.setFilter(retailerIds) },
      }),
    );
    if (typeof json.id !== 'string' || json.id === '') {
      throw new CatalogProviderError('Meta did not return a product set id.', 'meta', {
        code: null,
        subcode: null,
        httpStatus: 200,
        raw: null,
      });
    }
    return json.id;
  }

  async updateProductSet(
    b: CatalogBinding,
    setId: string,
    name: string,
    retailerIds: readonly string[],
  ): Promise<void> {
    await this.call(
      this.base(b, 'updateProductSet', {
        method: 'POST',
        url: await this.graph(setId),
        body: { name, filter: this.setFilter(retailerIds) },
      }),
    );
  }

  async deleteProductSet(b: CatalogBinding, setId: string): Promise<void> {
    await this.call(
      this.base(b, 'deleteProductSet', { method: 'DELETE', url: await this.graph(setId) }),
    );
  }
}

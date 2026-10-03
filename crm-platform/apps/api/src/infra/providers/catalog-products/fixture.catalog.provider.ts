import { Injectable } from '@nestjs/common';
import {
  CatalogProviderError,
  type BaileysCatalogBridge,
  type BaileysCard,
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

/** A message the fixture "delivered", for a test or a person exercising the UI to read back. */
export interface FixtureSent {
  via: 'meta' | 'baileys';
  kind: 'spm' | 'mpm' | 'catalog_message' | 'link' | 'text' | 'carousel' | 'image';
  to: string;
  catalogId: string | null;
  payload: Record<string, unknown>;
}

const metaError = (message: string, code: number, subcode: number | null = null) =>
  new CatalogProviderError(message, 'meta', { code, subcode, httpStatus: 400, raw: message });

/**
 * The deterministic sandbox behind `CAT_PROVIDER_MODE=fixture`: an in-memory stand-in for Meta and the Node bridge, so the
 * screens and the tests run without either. It is a singleton; nothing is persisted, and a restart forgets everything.
 *
 * Rules a person can rely on while exercising the UI:
 * - a catalog id that starts with `bad` is refused like Meta refuses a wrong id: code 100 "Unsupported get request";
 * - a token that contains `expired` is refused with code 190;
 * - every pushed batch is "finished" on the next poll, unless its handle is listed in `erroredHandles` (status `error`) or
 *   `inProgressHandles` (status `in_progress`);
 * - a message to a number listed in `rejectRecipients` fails with Meta's 24-hour window error 131047.
 */
@Injectable()
export class FixtureCatalogState {
  /** What Meta lists per catalog id; seeded by the test or empty. */
  metaProducts = new Map<string, MetaCatalogProduct[]>();
  /** The items last pushed per catalog id, by retailer id. */
  pushed = new Map<string, Map<string, Record<string, unknown>>>();
  batches: Array<{ handle: string; catalogId: string; retailerIds: string[] }> = [];
  erroredHandles = new Map<string, string>();
  inProgressHandles = new Set<string>();
  sent: FixtureSent[] = [];
  commerceSettings: Array<{
    phoneNumberId: string | null;
    catalogVisible: boolean;
    cartEnabled: boolean;
  }> = [];
  rejectRecipients = new Set<string>();
  /** The next provider call of this kind throws once (key: the method name). */
  failNext = new Map<string, CatalogProviderError>();
  /** Catalogs the WABA "has linked" on Meta, for autodetect. */
  wabaCatalogs = new Map<string, string[]>();
  createdCatalogs: Array<{ businessId: string; name: string; id: string }> = [];
  linked: Array<{ wabaId: string; catalogId: string }> = [];
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  reset(): void {
    this.metaProducts.clear();
    this.pushed.clear();
    this.batches = [];
    this.erroredHandles.clear();
    this.inProgressHandles.clear();
    this.sent = [];
    this.commerceSettings = [];
    this.rejectRecipients.clear();
    this.failNext.clear();
    this.wabaCatalogs.clear();
    this.createdCatalogs = [];
    this.linked = [];
  }

  takeFailure(op: string): void {
    const err = this.failNext.get(op);
    if (err) {
      this.failNext.delete(op);
      throw err;
    }
  }
}

@Injectable()
export class FixtureCatalogProvider implements CatalogProvider {
  constructor(private readonly state: FixtureCatalogState) {}

  private guard(op: string, b: { catalogId?: string; accessToken: string }): void {
    this.state.takeFailure(op);
    if (b.catalogId?.startsWith('bad')) {
      throw metaError('(#100) Unsupported get request.', 100);
    }
    if (b.accessToken.includes('expired')) {
      throw metaError('Error validating access token: Session has expired.', 190, 463);
    }
  }

  async verifyCatalog(b: CatalogBinding): Promise<CatalogInfo> {
    this.guard('verifyCatalog', b);
    return {
      id: b.catalogId,
      name: `Fixture catalog ${b.catalogId}`,
      productCount: this.state.pushed.get(b.catalogId)?.size ?? 0,
    };
  }

  async listProducts(b: CatalogBinding, max = 2000): Promise<MetaCatalogProduct[]> {
    this.guard('listProducts', b);
    return (this.state.metaProducts.get(b.catalogId) ?? []).slice(0, max);
  }

  async upsertProductsBatch(
    b: CatalogBinding,
    items: readonly CatalogBatchItem[],
  ): Promise<string[]> {
    this.guard('upsertProductsBatch', b);
    if (items.length === 0) return [];
    const store = this.state.pushed.get(b.catalogId) ?? new Map<string, Record<string, unknown>>();
    this.state.pushed.set(b.catalogId, store);
    const handles: string[] = [];
    for (const item of items) {
      store.set(item.retailerId, item.data);
      const handle = this.state.nextId('handle');
      handles.push(handle);
      this.state.batches.push({ handle, catalogId: b.catalogId, retailerIds: [item.retailerId] });
    }
    return handles;
  }

  async checkBatchStatus(
    b: CatalogBinding,
    handles: readonly string[],
  ): Promise<CatalogBatchStatus[]> {
    this.guard('checkBatchStatus', b);
    return handles.map((handle) => {
      const error = this.state.erroredHandles.get(handle);
      if (error !== undefined) return { handle, status: 'error', errors: [{ message: error }] };
      if (this.state.inProgressHandles.has(handle))
        return { handle, status: 'in_progress', errors: [] };
      return { handle, status: 'finished', errors: [] };
    });
  }

  async setCommerceSettings(
    b: CatalogBinding,
    s: { catalogVisible: boolean; cartEnabled: boolean },
  ): Promise<void> {
    this.guard('setCommerceSettings', b);
    if (!b.phoneNumberId) {
      throw new CatalogProviderError('Catalog has no phone_number_id bound.', 'config');
    }
    this.state.commerceSettings.push({ phoneNumberId: b.phoneNumberId, ...s });
  }

  private deliver(
    op: string,
    b: CatalogBinding,
    to: string,
    kind: FixtureSent['kind'],
    payload: Record<string, unknown>,
  ): SentMessage {
    this.guard(op, b);
    if (b.provider === 'meta_cloud' && !b.phoneNumberId) {
      throw new CatalogProviderError(
        'Catalog has no phone_number_id: Meta Cloud requires it on the /messages path.',
        'config',
      );
    }
    if (this.state.rejectRecipients.has(to)) {
      throw metaError(
        '(#131047) Re-engagement message: more than 24 hours have passed since the customer last replied.',
        131047,
      );
    }
    const messageId = this.state.nextId('wamid');
    this.state.sent.push({ via: 'meta', kind, to, catalogId: b.catalogId, payload });
    return { messageId, raw: { messages: [{ id: messageId }] } };
  }

  async sendSPM(
    b: CatalogBinding,
    to: string,
    retailerId: string,
    body: string | null,
    footer: string | null,
  ) {
    return this.deliver('sendSPM', b, to, 'spm', { retailerId, body, footer });
  }
  async sendMPM(
    b: CatalogBinding,
    to: string,
    header: string,
    body: string,
    sections: readonly MpmSection[],
    footer: string | null,
  ) {
    return this.deliver('sendMPM', b, to, 'mpm', { header, body, sections, footer });
  }
  async sendCatalogMessage(
    b: CatalogBinding,
    to: string,
    body: string,
    thumb: string,
    footer: string | null,
  ) {
    return this.deliver('sendCatalogMessage', b, to, 'catalog_message', { body, thumb, footer });
  }
  async sendCatalogLink(b: CatalogBinding, to: string, body: string) {
    return this.deliver('sendCatalogLink', b, to, 'link', { body });
  }
  async sendText(b: CatalogBinding, to: string, body: string) {
    return this.deliver('sendText', b, to, 'text', { body });
  }

  async listWabaCatalogs(a: GraphAuth, wabaId: string): Promise<string[]> {
    this.guard('listWabaCatalogs', a);
    return this.state.wabaCatalogs.get(wabaId) ?? [];
  }
  async createCatalog(a: GraphAuth, businessId: string, name: string): Promise<string | null> {
    this.guard('createCatalog', a);
    const id = this.state.nextId('cat');
    this.state.createdCatalogs.push({ businessId, name, id });
    return id;
  }
  async linkCatalogToWaba(a: GraphAuth, wabaId: string, catalogId: string): Promise<void> {
    this.guard('linkCatalogToWaba', a);
    this.state.linked.push({ wabaId, catalogId });
  }
  async catalogName(a: GraphAuth, catalogId: string): Promise<string | null> {
    this.guard('catalogName', a);
    return `Fixture catalog ${catalogId}`;
  }
}

/** The Node bridge stand-in: records what it was asked to send. */
@Injectable()
export class FixtureBaileysBridge implements BaileysCatalogBridge {
  constructor(private readonly state: FixtureCatalogState) {}

  async sendCarousel(input: {
    senderPhone: string;
    to: string;
    cards: readonly BaileysCard[];
    headerText: string;
    bodyText: string;
    footerText: string;
  }): Promise<SentMessage> {
    this.state.takeFailure('sendCarousel');
    if (this.state.rejectRecipients.has(input.to)) {
      throw new CatalogProviderError(
        'Baileys carousel failed: recipient is not on WhatsApp',
        'meta',
        {
          code: 404,
          subcode: null,
          httpStatus: 404,
          raw: 'recipient is not on WhatsApp',
        },
      );
    }
    const messageId = this.state.nextId('bailey');
    this.state.sent.push({
      via: 'baileys',
      kind: 'carousel',
      to: input.to,
      catalogId: null,
      payload: { ...input },
    });
    return { messageId, raw: { success: true, messageId } };
  }

  async sendText(input: { senderPhone: string; to: string; text: string }): Promise<SentMessage> {
    this.state.takeFailure('sendBridgeText');
    const messageId = this.state.nextId('bailey');
    this.state.sent.push({
      via: 'baileys',
      kind: 'text',
      to: input.to,
      catalogId: null,
      payload: { ...input },
    });
    return { messageId, raw: { success: true, messageId } };
  }

  async sendImage(input: {
    senderPhone: string;
    to: string;
    imageUrl: string;
    caption: string;
  }): Promise<SentMessage> {
    this.state.takeFailure('sendBridgeImage');
    const messageId = this.state.nextId('bailey');
    this.state.sent.push({
      via: 'baileys',
      kind: 'image',
      to: input.to,
      catalogId: null,
      payload: { ...input },
    });
    return { messageId, raw: { success: true, messageId } };
  }
}

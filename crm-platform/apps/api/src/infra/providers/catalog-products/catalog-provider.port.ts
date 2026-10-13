/**
 * The Meta commerce catalog, behind one port (TW-CAT-034). Meta Cloud (direct) and 360dialog carry byte-identical payloads: the
 * catalog calls always go to the Graph API with the catalog row's token, and only the MESSAGES endpoint differs (Meta Cloud
 * `graph/<version>/<phone_number_id>`, 360dialog its own host, authenticated with `D360-API-KEY`).
 *
 * The adapters are transport only. Which products are pushed, how a price is converted and what a failure means for a product
 * live in the catalog-products module, so the live adapter and the in-memory fixture can be swapped without touching them.
 */

export type CatalogProviderCode = 'meta_cloud' | 'dialog_360';

/** What an adapter needs to talk to one catalog; the token is already decrypted and never leaves the call. */
export interface CatalogBinding {
  provider: CatalogProviderCode;
  catalogId: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  accessToken: string;
}

/** A failure at the provider boundary, normalised. The service turns it into the problem the caller sees. */
export class CatalogProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'meta' | 'network' | 'config',
    readonly meta: {
      code: number | null;
      subcode: number | null;
      httpStatus: number | null;
      /** Meta's own message, without our decoration. */
      raw: string | null;
    } = { code: null, subcode: null, httpStatus: null, raw: null },
  ) {
    super(message);
    this.name = 'CatalogProviderError';
  }
}

export interface CatalogInfo {
  id: string;
  name: string | null;
  productCount: number | null;
}

/** One product as Meta lists it (TW-CAT-011). `price` stays as Meta sent it: an integer in the currency's minor unit or a formatted string. */
export interface MetaCatalogProduct {
  metaId: string;
  retailerId: string;
  name: string;
  description: string | null;
  price: number | string | null;
  currency: string | null;
  availability: string | null;
  imageUrl: string | null;
  url: string | null;
}

/** One `CREATE` request of an items_batch: Meta treats it as an upsert on the retailer id. */
export interface CatalogBatchItem {
  retailerId: string;
  data: Record<string, unknown>;
}

export interface CatalogBatchStatus {
  handle: string;
  status: string;
  errors: Array<{ message: string }>;
}

export interface MpmSection {
  title: string;
  productRetailerIds: string[];
}

export interface SentMessage {
  messageId: string | null;
  /** The provider's raw reply, kept for the send log. */
  raw: unknown;
}

export interface GraphAuth {
  accessToken: string;
}

export interface CatalogProvider {
  /** GET the catalog object; proves the id and the token (TW-CAT-002). */
  verifyCatalog(b: CatalogBinding): Promise<CatalogInfo>;
  /** Up to `max` products, 200 per page, at most 50 pages (TW-CAT-011). */
  listProducts(b: CatalogBinding, max?: number): Promise<MetaCatalogProduct[]>;
  upsertProductsBatch(b: CatalogBinding, items: readonly CatalogBatchItem[]): Promise<string[]>;
  checkBatchStatus(b: CatalogBinding, handles: readonly string[]): Promise<CatalogBatchStatus[]>;
  setCommerceSettings(
    b: CatalogBinding,
    settings: { catalogVisible: boolean; cartEnabled: boolean },
  ): Promise<void>;

  sendSPM(
    b: CatalogBinding,
    to: string,
    retailerId: string,
    body: string | null,
    footer: string | null,
  ): Promise<SentMessage>;
  sendMPM(
    b: CatalogBinding,
    to: string,
    header: string,
    body: string,
    sections: readonly MpmSection[],
    footer: string | null,
  ): Promise<SentMessage>;
  sendCatalogMessage(
    b: CatalogBinding,
    to: string,
    body: string,
    thumbnailRetailerId: string,
    footer: string | null,
  ): Promise<SentMessage>;
  sendCatalogLink(b: CatalogBinding, to: string, body: string): Promise<SentMessage>;
  /** Plain text: the concierge's empty reply and the order acknowledgement. */
  sendText(b: CatalogBinding, to: string, body: string): Promise<SentMessage>;

  // Autodetect (TW-CAT-003): the WABA's own token, no catalog row yet.
  listWabaCatalogs(auth: GraphAuth, wabaId: string): Promise<string[]>;
  createCatalog(auth: GraphAuth, businessId: string, name: string): Promise<string | null>;
  linkCatalogToWaba(auth: GraphAuth, wabaId: string, catalogId: string): Promise<void>;
  catalogName(auth: GraphAuth, catalogId: string): Promise<string | null>;

  // Manage the catalog on Meta from here (create reuses `createCatalog` + `linkCatalogToWaba` above).
  /** Rename the catalog on Meta. */
  renameCatalog(b: CatalogBinding, name: string): Promise<void>;
  /** Delete the catalog on Meta. Irreversible there; the caller confirms first. */
  deleteCatalog(b: CatalogBinding): Promise<void>;
  /** Create a product set holding these retailer ids; returns Meta's set id. */
  createProductSet(
    b: CatalogBinding,
    name: string,
    retailerIds: readonly string[],
  ): Promise<string>;
  updateProductSet(
    b: CatalogBinding,
    setId: string,
    name: string,
    retailerIds: readonly string[],
  ): Promise<void>;
  deleteProductSet(b: CatalogBinding, setId: string): Promise<void>;
}

export const CATALOG_PROVIDER = Symbol('CATALOG_PROVIDER');

/** One card of the Baileys carousel (what Reference posted to the Node bridge). */
export interface BaileysCard {
  retailer_id: string;
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  /** The major amount (`price_minor / 100`). */
  price: number;
  currency: string;
  category: string | null;
  availability: string;
  url: string | null;
}

/**
 * The Node bridge that holds an unofficial (QR-paired) session. Same two endpoints as Reference:
 * `POST /api/send-product-catalog/{senderPhone}` (carousel) and `POST /api/send-message/{senderPhone}` (text).
 */
export interface BaileysCatalogBridge {
  sendCarousel(input: {
    /** The workspace that owns the sending number. Required from a worker (no request context); a request supplies it itself. */
    orgId?: number;
    senderPhone: string;
    to: string;
    cards: readonly BaileysCard[];
    headerText: string;
    bodyText: string;
    footerText: string;
  }): Promise<SentMessage>;
  sendText(input: {
    orgId?: number;
    senderPhone: string;
    to: string;
    text: string;
  }): Promise<SentMessage>;
  /** An image by URL with a caption: the single-product share (TW-CAT-023), `POST /api/send-media-message/{senderPhone}`. */
  sendImage(input: {
    orgId?: number;
    senderPhone: string;
    to: string;
    imageUrl: string;
    caption: string;
  }): Promise<SentMessage>;
}

export const BAILEYS_CATALOG_BRIDGE = Symbol('BAILEYS_CATALOG_BRIDGE');

/**
 * Where the unofficial engine's own domain announces how it sends for the catalog. `CatalogProvidersModule` binds `BAILEYS_CATALOG_BRIDGE`
 * to this when some (global) module provides it, and to the HTTP bridge otherwise: the catalog does not import the engine, the engine
 * hands its sender in.
 */
export const BAILEYS_CATALOG_BRIDGE_OVERRIDE = Symbol('BAILEYS_CATALOG_BRIDGE_OVERRIDE');

/**
 * What the live adapters read from the platform's settings at call time (TW-CAT-030, 034): the Graph API version and where the
 * Node bridge is. The catalog module implements it over the platform settings store (with the environment as the fallback), so
 * an adapter never reads settings itself.
 */
export interface CatalogRuntimeSettings {
  /** `vNN.N`: the operator's saved version, else the environment's, else `v23.0`. */
  graphVersion(): Promise<string>;
  /** The bridge's address and shared token: the operator's saved values, else the environment's. */
  bridgeTarget(): Promise<{ baseUrl: string; token: string | null }>;
}

export const CATALOG_RUNTIME_SETTINGS = Symbol('CATALOG_RUNTIME_SETTINGS');

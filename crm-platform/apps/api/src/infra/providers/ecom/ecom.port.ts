/**
 * The two stores the integrations talk to (TW-ECOM-005, 006, 007, 025, 026): Shopify's Admin API and OAuth, and a merchant's
 * WooCommerce REST API. Ports so tests answer for the stores; the adapters keep the address rules and timeouts in one place.
 * Reading and importing a store's resources is added to these ports by the import step.
 */

export type EcomResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A Shopify store is always `<handle>.myshopify.com`: the only addresses an adapter will call. */
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/** The platform's Shopify app, from the operator's settings. `clientSecret` stays server side. */
export interface ShopifySettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string;
  redirectUri: string;
}

export interface ShopInfo {
  id: string | null;
  name: string | null;
  email: string | null;
  owner: string | null;
  plan: string | null;
  currency: string | null;
  country: string | null;
}

/** Calls made with the platform's app credentials, before a store has a token. */
export interface ShopifyAppApi {
  /** The permanent access token for an authorization code. */
  exchangeCode(
    shop: string,
    code: string,
  ): Promise<EcomResult<{ accessToken: string; scope: string }>>;
}

/** One resource record as the store sends it; the importer picks out what it needs and trusts nothing. */
export type StoreRecord = Record<string, unknown>;

/**
 * A resource read to the end of its pages, at most `MAX_PAGES` of them. `complete` is false when the store stopped answering or the
 * page cap was reached, so the import can say it was partial instead of pretending it brought everything.
 */
export interface StoreRead {
  items: StoreRecord[];
  complete: boolean;
}

/** What the store reports as its size. A count that cannot be read is 0. */
export interface StoreCounts {
  products: number;
  orders: number;
  customers: number;
}

/** Most pages read for one resource in one import: 250 a page on Shopify, 100 on WooCommerce. */
export const MAX_PAGES = 10;

/** Calls made as one store. */
export interface ShopifyStoreApi {
  shop(): Promise<EcomResult<ShopInfo>>;
  counts(): Promise<StoreCounts>;
  products(): Promise<StoreRead>;
  orders(): Promise<StoreRead>;
  customers(): Promise<StoreRead>;
  /** Subscribes each topic to the address; returns topic to the store's webhook id for those that were created. */
  registerWebhooks(address: string, topics: readonly string[]): Promise<Record<string, string>>;
  /** Removes the subscriptions; a failure is ignored (the store may already be gone). */
  deleteWebhooks(ids: readonly string[]): Promise<void>;
}

export interface ShopifyFactory {
  app(settings: ShopifySettings): ShopifyAppApi;
  store(shop: string, accessToken: string): ShopifyStoreApi;
}
export const SHOPIFY = Symbol('ECOM_SHOPIFY');

export interface WooStoreInfo {
  name: string | null;
  currency: string | null;
  country: string | null;
  version: string | null;
}

/** Calls made as one WooCommerce store, with its consumer key and secret. */
export interface WooStoreApi {
  /** Reads `system_status`: proves the key and secret work and says what the store is. */
  test(): Promise<EcomResult<WooStoreInfo>>;
  counts(): Promise<StoreCounts>;
  products(): Promise<StoreRead>;
  orders(): Promise<StoreRead>;
  customers(): Promise<StoreRead>;
  registerWebhooks(a: {
    deliveryUrl: string;
    secret: string;
    topics: readonly string[];
    nameOf: (topic: string) => string;
  }): Promise<Record<string, string>>;
  deleteWebhooks(ids: readonly string[]): Promise<void>;
  /** Changes a real order (its `status`, its `shipping` address, ...). False when the store refused or did not answer. */
  updateOrder(orderId: string, patch: Record<string, unknown>): Promise<boolean>;
  /**
   * Creates a pending order for these items (by sku, or by id when the reference is only digits) and returns the link the customer
   * pays at. Null when the store refused or gave no link.
   */
  createPendingOrder(
    items: ReadonlyArray<{ reference: string; qty: number }>,
    flowSessionId: string | null,
  ): Promise<{ url: string; orderId: string } | null>;
}

export interface WooFactory {
  store(storeUrl: string, consumerKey: string, consumerSecret: string): WooStoreApi;
}
export const WOOCOMMERCE = Symbol('ECOM_WOOCOMMERCE');

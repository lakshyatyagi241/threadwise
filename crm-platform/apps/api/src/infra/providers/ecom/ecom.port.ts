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

/** Calls made as one store. */
export interface ShopifyStoreApi {
  shop(): Promise<EcomResult<ShopInfo>>;
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
  registerWebhooks(a: {
    deliveryUrl: string;
    secret: string;
    topics: readonly string[];
    nameOf: (topic: string) => string;
  }): Promise<Record<string, string>>;
  deleteWebhooks(ids: readonly string[]): Promise<void>;
}

export interface WooFactory {
  store(storeUrl: string, consumerKey: string, consumerSecret: string): WooStoreApi;
}
export const WOOCOMMERCE = Symbol('ECOM_WOOCOMMERCE');

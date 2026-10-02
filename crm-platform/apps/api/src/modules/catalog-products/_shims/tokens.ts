import type { Tx } from '@crm/db';

/** A number the organization can send from right now. */
export interface CatalogSenderRow {
  /** `<engine>:<uuid>`: what the Send tab posts back. */
  key: string;
  engine: 'baileys' | 'waba' | 'twilio';
  /** Internal id in the engine's table (devices for baileys, wa_provider_configs otherwise). */
  id: number;
  label: string;
  /** The country code and number as the digits a bridge or `wa.me` needs; null when there is none. */
  phone: string | null;
}

/** The decrypted credentials of the connected WABA number (TW-CAT-003). */
export interface WabaCredentials {
  configId: number;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  businessId: string;
  catalogId: string;
  /** The raw `meta_json` of the config, so the catalog id can be merged back without losing keys. */
  metaJson: Record<string, unknown>;
}

/**
 * The numbers messages can leave from. The device and WABA domains own these tables; this reads them until they export
 * a lookup (see `_shims/README.md`).
 */
export interface SenderDirectory {
  /** Every connected sender: Baileys devices (active first), then connected WABA and Twilio configs (newest first). */
  list(tx: Tx, orgId: number): Promise<CatalogSenderRow[]>;
  /** One picked key; unknown, stale or disconnected keys give undefined. */
  resolve(tx: Tx, orgId: number, key: string): Promise<CatalogSenderRow | undefined>;
  /** The Baileys device a send leaves from: the picked one when connected, else the first connected (active first). */
  baileysDevice(
    tx: Tx,
    orgId: number,
    pickedKey: string | undefined,
  ): Promise<CatalogSenderRow | undefined>;
  /** The primary connected WABA config with its token decrypted; undefined when there is none. */
  wabaCredentials(tx: Tx, orgId: number): Promise<WabaCredentials | undefined>;
  /** Merges `catalog_id` into the WABA config's `meta_json` so a reconnect keeps it. */
  saveWabaCatalogId(tx: Tx, orgId: number, configId: number, catalogId: string): Promise<void>;
  /** The phone of the primary connected provider config (the `wa.me` share link), or null. */
  primaryPhone(tx: Tx, orgId: number): Promise<string | null>;
}
export const SENDER_DIRECTORY = Symbol('CATALOG_SENDER_DIRECTORY');

export interface AudienceGroup {
  id: number;
  uuid: string;
  name: string;
  count: number;
}
export interface AudienceContact {
  uuid: string;
  name: string | null;
  mobile: string | null;
}

/** Contacts and contact groups, read for the Send tab; the CRM module owns them. */
export interface AudienceDirectory {
  groups(tx: Tx, orgId: number): Promise<AudienceGroup[]>;
  /** The newest `limit` contacts, optionally narrowed by a name or number search. */
  contacts(tx: Tx, orgId: number, opts: { q?: string; limit: number }): Promise<AudienceContact[]>;
  /** The mobile numbers of these contacts (workspace-scoped; a foreign uuid yields nothing). */
  phonesOfContacts(tx: Tx, orgId: number, uuids: readonly string[]): Promise<string[]>;
  /** The mobile numbers of every member of these groups. */
  phonesOfGroups(tx: Tx, orgId: number, uuids: readonly string[]): Promise<string[]>;
}
export const AUDIENCE_DIRECTORY = Symbol('CATALOG_AUDIENCE_DIRECTORY');

export interface ShopRow {
  id: number;
  uuid: string;
  shopName: string | null;
  slug: string;
  /** The buyer-facing address: the verified custom domain, else `<app url>/s/<slug>`. */
  publicUrl: string;
}

/** The workspace's shops (storefront-builder owns them). */
export interface ShopDirectory {
  /** Newest first. */
  list(tx: Tx, orgId: number): Promise<ShopRow[]>;
  /** The oldest shop (what the share link of a product uses, as Reference). */
  oldest(tx: Tx, orgId: number): Promise<ShopRow | undefined>;
  findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ShopRow | undefined>;
}
export const SHOP_DIRECTORY = Symbol('CATALOG_SHOP_DIRECTORY');

export interface CatalogSendMirrorInput {
  /**
   * `catalog`: a catalog message (single product, product list or link), shown as the catalog bubble. `product_share`: one
   * product sent as an image with a caption (TW-CAT-023), shown as that text with `meta.source = 'product_share'`.
   */
  source?: 'catalog' | 'product_share';
  orgId: number;
  recipientDigits: string;
  userId: number | null;
  mode: 'spm' | 'mpm' | 'link';
  body: string | null;
  provider: 'meta' | 'baileys';
  messageId: string | null;
  products: Array<{
    id: number;
    name: string;
    imageUrl: string | null;
    priceMinor: number;
    currency: string;
    retailerId: string;
  }>;
}

/**
 * Mirrors a catalog message into the recipient's inbox thread. Implemented by `InboxConversationMirror` over the chat-conversations
 * facade (the token stays here because the send service and the tests inject it). Called after the provider accepted the message,
 * never inside a transaction.
 */
export interface ConversationMirror {
  mirrorCatalogSend(input: CatalogSendMirrorInput): Promise<void>;
}
export const CONVERSATION_MIRROR = Symbol('CATALOG_CONVERSATION_MIRROR');

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `shopify-woocommerce.module.ts` and delete the default.
 */

import type { Tx } from '@crm/db';
import type { MirrorCustomer, MirrorOrder, MirrorProduct, StoreKind } from '../mirror-rules';

export type { StoreKind };

/** The plan features `integration_shopify` and `integration_woocommerce` (plans-subscriptions-trials). */
export interface EcomPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the integration. */
  assertIntegration(orgId: number, kind: StoreKind): Promise<void>;
}
export const ECOM_PLAN_GATE = Symbol('ECOM_PLAN_GATE');

/**
 * Writes a store's products, orders and customers into the CRM (TW-ECOM-011, 012): `wa_products` (catalog), `wa_orders` (checkout) and
 * `contacts` with the store's customer group (contacts). Each row is keyed by the store's own id, so running an import again updates
 * in place and never duplicates. The owning domains replace this with their own writers; until then `SqlStoreMirror` does the writes.
 */
export interface StoreMirror {
  upsertProduct(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    userId: number | null,
    p: MirrorProduct,
  ): Promise<void>;
  /** The mirrored order's id. */
  upsertOrder(tx: Tx, orgId: number, kind: StoreKind, o: MirrorOrder): Promise<number>;
  /** The store's customer group: the one with this id when it still exists, else a new one. */
  ensureGroup(
    tx: Tx,
    orgId: number,
    userId: number | null,
    kind: StoreKind,
    cachedId: number | null,
  ): Promise<number>;
  /** A customer as a contact in the group. True when a contact was created; false when one with that number already existed. */
  upsertCustomer(
    tx: Tx,
    orgId: number,
    userId: number | null,
    kind: StoreKind,
    c: MirrorCustomer,
    groupId: number,
  ): Promise<boolean>;
}
export const STORE_MIRROR = Symbol('ECOM_STORE_MIRROR');

/** A WhatsApp template an automation can send. */
export interface EcomTemplate {
  id: number;
  uuid: string;
  name: string;
  language: string;
  body: string;
}

/** Reads the message templates an automation points at (message-templates domain). */
export interface EcomTemplates {
  /** The template when it exists and can be sent now: not submitted to Meta, or approved by it. */
  sendable(tx: Tx, orgId: number, id: number): Promise<EcomTemplate | undefined>;
}
export const ECOM_TEMPLATES = Symbol('ECOM_TEMPLATES');

/** Sends one approved template to one customer (TW-ECOM-010). Throws with a reason a person can act on. */
export interface CommerceSender {
  send(
    orgId: number,
    m: { to: string; template: EcomTemplate; params: string[]; reference: string },
  ): Promise<{ providerMessageId: string | null }>;
}
export const COMMERCE_SENDER = Symbol('ECOM_COMMERCE_SENDER');

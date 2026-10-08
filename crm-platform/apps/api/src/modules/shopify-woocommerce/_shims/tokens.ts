/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `shopify-woocommerce.module.ts` and delete the default.
 */

import type { Tx } from '@crm/db';
import type { EventContext } from '../event-rules';
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
  header: string | null;
  footer: string | null;
}

/** Reads the message templates an automation points at (message-templates domain). */
export interface EcomTemplates {
  /** The template when it exists and can be sent now: not submitted to Meta, or approved by it. */
  sendable(tx: Tx, orgId: number, id: number): Promise<EcomTemplate | undefined>;
  /** The id of the organization's template with this uuid; another tenant's template is simply not found. */
  idOf(tx: Tx, orgId: number, uuid: string): Promise<number | undefined>;
}
export const ECOM_TEMPLATES = Symbol('ECOM_TEMPLATES');

/**
 * Sends one template to one customer through the number the workspace sends from (TW-ECOM-010): the chosen "send from" number, else
 * its default engine's. A Cloud API number gets the approved template with the numbered values; the unofficial engine and Twilio get the
 * template rendered as text (header, body, footer). Throws with a reason a person can act on.
 */
export interface CommerceSender {
  send(
    orgId: number,
    m: {
      to: string;
      template: EcomTemplate;
      /** The values that fill the template, named and numbered. */
      ctx: EventContext;
      reference: string;
      /** `engine:uuid` of the number to send from (TW-ECOM-033); absent means the workspace's default engine. */
      senderKey?: string | null;
    },
  ): Promise<{ providerMessageId: string | null }>;
  /** Whether a number is connected to send from now (nothing is scheduled for a workspace that has none). */
  canSend(orgId: number): Promise<boolean>;
  /** A plain text answer to a message the customer just sent (inside their open session): the COD, stock and concierge replies. */
  sendText(
    orgId: number,
    m: { to: string; body: string; reference: string },
  ): Promise<{ providerMessageId: string | null }>;
}
export const COMMERCE_SENDER = Symbol('ECOM_COMMERCE_SENDER');

/** A store delivery that may need an invoice (TW-ECOM-035): the paid-order hand-off to the invoicing domain. */
export interface PaidStoreOrder {
  orgId: number;
  kind: StoreKind;
  storeId: number;
  /** The webhook topic (`orders/paid`, `order.updated`). */
  topic: string;
  /** `X-Shopify-Webhook-Id` / `X-WC-Webhook-Delivery-ID`: one delivery is handled once. */
  deliveryId: string;
  /** The raw order body the store sent. */
  data: Record<string, unknown>;
}

export type HandOffOutcome =
  | { outcome: 'invoiced' | 'existing'; invoiceId: number }
  | {
      outcome: 'ignored';
      reason:
        | 'not_an_order'
        | 'auto_invoice_off'
        | 'trigger_not_met'
        | 'replay'
        | 'plan_has_no_invoicing'
        | 'no_mirrored_order'
        | 'plan_limit_reached'
        | 'nothing_to_invoice';
    };

/**
 * Where a paid store order goes to be billed. The pipeline calls it once per delivery, after the mirror holds the order, inside its own
 * guard: it may throw, the delivery is never failed by it. Bound to `InvoicingPaidOrderHook` (ecom calls the invoicing module's
 * `ExternalOrderBillingService`); the token is the seam.
 */
export interface PaidOrderHook {
  handOff(order: PaidStoreOrder): Promise<HandOffOutcome>;
}
export const PAID_ORDER_HOOK = Symbol('ECOM_PAID_ORDER_HOOK');

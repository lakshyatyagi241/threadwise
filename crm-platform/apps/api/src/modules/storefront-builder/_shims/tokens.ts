import type { Tx } from '@crm/db';
import type { CouponTerms } from '../rules/coupon-rules';
import type { PhoneHistory } from '../rules/rto';

/** One line of `wa_orders.items_json`, in the shape Reference wrote (and the CHK order screens read). */
export interface OrderLine {
  product_id: number;
  name: string;
  qty: number;
  price_minor: number;
  image: string | null;
  /** The Meta retailer id, else the SKU, else null. */
  retailer_id: string | null;
}

/** The order a storefront checkout writes (TW-STORE-013): status is always `new`, source always `storefront`. */
export interface NewStorefrontOrder {
  storefrontId: number;
  /** Digits and a leading `+`. */
  customerPhone: string;
  customerName: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  items: OrderLine[];
  totalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  couponCode: string | null;
  currencyCode: string;
  paymentMethod: 'prepaid' | 'cod';
  rtoScore: number | null;
  rtoBand: string | null;
  /** 40 random characters: also the public tracking token. */
  recoveryToken: string;
  notes: string | null;
}

export interface PlacedOrder {
  /** The order number the buyer is shown. */
  id: number;
  uuid: string;
}

export interface OrderRecord {
  id: number;
  uuid: string;
  storefrontId: number | null;
  status: string;
  paymentMethod: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  items: Array<Record<string, unknown>>;
  totalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  currencyCode: string;
  paymentLink: string | null;
  metaJson: Record<string, unknown> | null;
  recoveryToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardOrders {
  revenueMinor: number;
  orders: number;
}

export interface RecentOrder {
  id: number;
  uuid: string;
  customerName: string | null;
  customerPhone: string | null;
  itemsCount: number;
  totalMinor: number;
  currencyCode: string;
  status: string;
  source: string;
  createdAt: Date;
}

/**
 * The orders table as the storefront needs it. Owner: checkout-orders-merchant-payments (CHK). Until CHK exports an order
 * service, `SqlOrdersGateway` writes and reads `wa_orders` directly; bind CHK's service to this token and delete the shim.
 */
export interface OrdersGateway {
  create(tx: Tx, orgId: number, order: NewStorefrontOrder): Promise<PlacedOrder>;
  /** Last `days` days (rolling, from now), every source and status, as the dashboard counts them. */
  window(tx: Tx, orgId: number, days: number): Promise<DashboardOrders>;
  /** One bucket per calendar day (UTC), oldest first, `days` of them ending today. Revenue is minor units. */
  salesByDay(
    tx: Tx,
    orgId: number,
    days: number,
  ): Promise<Array<{ day: string; revenueMinor: number; orders: number }>>;
  /** Item names ranked by units sold over the window; ties keep the order they first appeared in. */
  topProducts(
    tx: Tx,
    orgId: number,
    days: number,
    limit: number,
  ): Promise<Array<{ name: string; qty: number }>>;
  recent(tx: Tx, orgId: number, limit: number): Promise<RecentOrder[]>;
  /** Prior orders of a phone over every channel, compared as digits. */
  phoneHistory(tx: Tx, orgId: number, phoneDigits: string): Promise<PhoneHistory>;
  /** Average of every positive order total of the organization, minor units; 0 when there is none. */
  averageTotalMinor(tx: Tx, orgId: number): Promise<number>;
  findByToken(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    token: string,
  ): Promise<OrderRecord | undefined>;
  /** Row-locked: the webhook reads then writes the same order. */
  findForPayment(tx: Tx, orgId: number, orderId: number): Promise<OrderRecord | undefined>;
  markPaid(
    tx: Tx,
    orgId: number,
    orderId: number,
    patch: { paymentLink: string | null; meta: Record<string, unknown> },
  ): Promise<void>;
  deleteByStorefront(tx: Tx, orgId: number, storefrontId: number): Promise<number>;
  deleteAll(tx: Tx, orgId: number): Promise<number>;
}
export const ORDERS_GATEWAY = Symbol('STORE_ORDERS_GATEWAY');

export interface CouponRecord extends CouponTerms {
  id: number;
}

/**
 * Coupons are created and listed by CHK (`/store/coupons`); the shop only resolves a code and counts a use. Owner:
 * checkout-orders-merchant-payments (CHK).
 */
export interface CouponDirectory {
  /**
   * The coupon a code names for this shop: the code compared ignoring case, active, and either for every shop of the
   * organization or for this one. `lock` row-locks it (checkout re-checks the rules against the locked row).
   */
  resolve(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    code: string,
    opts?: { lock?: boolean },
  ): Promise<CouponRecord | null>;
  /** Counts one use. The caller holds the row lock taken by `resolve({lock: true})`. */
  increment(tx: Tx, orgId: number, couponId: number): Promise<void>;
}
export const COUPON_DIRECTORY = Symbol('STORE_COUPON_DIRECTORY');

export interface WizardDevice {
  id: number;
  uuid: string;
  label: string;
  phone: string | null;
}

export interface RecoverySender {
  /** `baileys`, `waba` or `twilio`: the engine of the workspace. */
  engine: string;
  /** Internal id in the engine's own table (devices for baileys, wa_provider_configs otherwise). */
  id: number;
  fromDigits: string;
}

/**
 * The numbers a shop can send and be reached from. Owner: whatsapp-devices-baileys and whatsapp-cloud-api-waba
 * (`WorkspaceEngine`). Reads `devices` and `wa_provider_configs` until those domains export their own lookup.
 */
export interface SenderDirectory {
  /** Connected devices of the organization, and whether anything can send (a connected device or a connected primary config). */
  wizard(tx: Tx, orgId: number): Promise<{ devices: WizardDevice[]; hasSender: boolean }>;
  /** A CONNECTED device of this organization by uuid (the wizard's pick); undefined for any other. */
  connectedDevice(tx: Tx, orgId: number, uuid: string): Promise<{ id: number } | undefined>;
  /** The "sending number" label of each shop (Reference `sending_label`), in the order of the input. Null when nothing is connected. */
  sendingLabels(
    tx: Tx,
    orgId: number,
    deviceIds: ReadonlyArray<number | null>,
  ): Promise<Array<string | null>>;
  /** Digits of the number the buyer is sent to chat with (TW-STORE-011 rule 1); null when there is none. */
  waNumber(tx: Tx, orgId: number, deviceId: number | null): Promise<string | null>;
  /** Who sends a cart-recovery nudge; null when the workspace has no sender for its engine (nothing is scheduled then). */
  recoverySender(tx: Tx, orgId: number): Promise<RecoverySender | null>;
}
export const SENDER_DIRECTORY = Symbol('STORE_SENDER_DIRECTORY');

/**
 * Sends the plain-text cart-recovery nudge. Owner: the channel domains. Throws a readable error when the number cannot send
 * (no credentials, engine without an adapter); the sweep logs it, as Reference logged "no sender".
 */
export interface RecoveryNudgeSender {
  send(orgId: number, sender: RecoverySender, toDigits: string, body: string): Promise<void>;
}
export const RECOVERY_NUDGE_SENDER = Symbol('STORE_RECOVERY_NUDGE_SENDER');

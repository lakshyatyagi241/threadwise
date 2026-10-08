import { shopifyRecipient, wooRecipient } from './event-rules';
import type { StoreKind } from './mirror-rules';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '';

/** A store event a flow can start on (`shopify_event` and `woocommerce_event` triggers; the names are the editor's `FLB_STORE_EVENTS`). */
export interface StoreFlowEvent {
  event:
    | 'checkout_started'
    | 'abandoned_cart'
    | 'order_fulfilled'
    | 'order_refunded'
    | 'order_cancelled'
    | 'ordered_product';
  /** Names this occurrence: a repeat of the same delivery is the same reason, so the flow does not run twice for it. */
  ref: string;
  /** The customer's number as the store sent it; null when the delivery carries none (a Shopify refund: the order has it). */
  phone: string | null;
  /** `refunds/create` carries only the order's id: the caller finds the order's number. */
  orderId: string | null;
  productIds: string[];
  /** Run variables the flow starts with (`order_number`, `total`, `checkout_url`, ...). Blank ones are left out. */
  variables: Record<string, string>;
}

const clean = (v: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));

function shopify(topic: string, d: Json): StoreFlowEvent[] {
  const id = str(d.id) || str(d.token);
  const phone = shopifyRecipient(d);
  const base = clean({
    order_number: str(d.name) || str(d.order_number),
    total: str(d.total_price),
    currency: str(d.currency),
    checkout_url: str(d.abandoned_checkout_url),
    name: str(obj(d.customer).first_name),
  });
  const products = arr(d.line_items)
    .map((i) => str(obj(i).product_id))
    .filter((x) => x !== '');
  const one = (
    event: StoreFlowEvent['event'],
    extra: Partial<StoreFlowEvent> = {},
  ): StoreFlowEvent => ({
    event,
    ref: id,
    phone,
    orderId: null,
    productIds: [],
    variables: base,
    ...extra,
  });
  switch (topic) {
    case 'checkouts/create':
      return [one('checkout_started')];
    case 'orders/create':
      return products.length > 0 ? [one('ordered_product', { productIds: products })] : [];
    case 'orders/fulfilled':
      return [one('order_fulfilled')];
    case 'orders/cancelled':
      return [one('order_cancelled')];
    case 'refunds/create':
      return [
        one('order_refunded', { ref: `refund:${id}`, phone: null, orderId: str(d.order_id) }),
      ];
    default:
      return [];
  }
}

function woo(topic: string, d: Json): StoreFlowEvent[] {
  const id = str(d.id);
  const phone = wooRecipient(d);
  const base = clean({
    order_number: str(d.number) || id,
    total: str(d.total),
    currency: str(d.currency),
    name: str(obj(d.billing).first_name),
  });
  const one = (
    event: StoreFlowEvent['event'],
    extra: Partial<StoreFlowEvent> = {},
  ): StoreFlowEvent => ({
    event,
    ref: id,
    phone,
    orderId: null,
    productIds: [],
    variables: base,
    ...extra,
  });
  if (topic === 'checkout.created') return [one('checkout_started')];
  if (topic !== 'order.created' && topic !== 'order.updated') return [];
  const out: StoreFlowEvent[] = [];
  const products = arr(d.line_items)
    .map((i) => str(obj(i).product_id))
    .filter((x) => x !== '');
  if (topic === 'order.created' && products.length > 0) {
    out.push(one('ordered_product', { productIds: products }));
  }
  const status = str(d.status);
  if (status === 'completed') out.push(one('order_fulfilled'));
  else if (status === 'cancelled') out.push(one('order_cancelled'));
  else if (status === 'refunded') out.push(one('order_refunded'));
  return out;
}

/**
 * The flow-trigger events one verified store delivery stands for. Pure: the delivery's topic and body in, the events out. A delivery
 * with no id gives none (nothing to name the occurrence by). The abandoned cart is not a delivery: the cart recovery announces it
 * when its first follow-up comes due.
 */
export function storeFlowEvents(kind: StoreKind, topic: string, data: Json): StoreFlowEvent[] {
  const events = kind === 'shopify' ? shopify(topic, data) : woo(topic, data);
  return events.filter((e) => e.ref !== '' && e.ref !== 'refund:');
}

import type { CatalogAutomation, SaveAutomationInput } from '@crm/contracts';

/**
 * The automation switches live as keys of the catalog row's `meta_json` (WD-CAT-006). Two keys have no control on the screen
 * (`concierge_footer`, `order_ack_template_id`); they are read by their consumers and survive every save.
 */
type Meta = Record<string, unknown>;

export const asMeta = (v: unknown): Meta =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Meta) } : {};

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** What the Automation form shows: a workspace that never saved it gets the acknowledgement ON and the concierge OFF. */
export function readAutomation(metaJson: unknown): CatalogAutomation {
  const m = asMeta(metaJson);
  const max = Number(m.concierge_max);
  return {
    orderAckEnabled: m.order_ack_enabled === undefined ? true : m.order_ack_enabled !== false,
    orderAckPayUrl: text(m.order_ack_pay_url),
    conciergeEnabled: m.concierge_enabled === true,
    conciergeHeader: text(m.concierge_header),
    conciergeMax: Number.isFinite(max) ? Math.max(1, Math.min(30, Math.trunc(max))) : 10,
    conciergeReplyOnEmpty: m.concierge_reply_on_empty === true,
    conciergeEmptyText: text(m.concierge_empty_text),
  };
}

/** The new `meta_json`: the seven form keys replaced, everything else kept. A missing checkbox is false, a blank text null. */
export function applyAutomation(existing: unknown, input: SaveAutomationInput): Meta {
  const blank = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);
  return {
    ...asMeta(existing),
    order_ack_enabled: input.orderAckEnabled,
    order_ack_pay_url: blank(input.orderAckPayUrl),
    concierge_enabled: input.conciergeEnabled,
    concierge_header: blank(input.conciergeHeader),
    concierge_max: input.conciergeMax,
    concierge_reply_on_empty: input.conciergeReplyOnEmpty,
    concierge_empty_text: blank(input.conciergeEmptyText),
  };
}

/** The acknowledgement default is ON: only an explicit `false` turns it off (WD-CAT-029). */
export const orderAckEnabled = (metaJson: unknown): boolean =>
  asMeta(metaJson).order_ack_enabled !== false;

export interface OrderAckInput {
  customerName: string | null;
  orderNumber: string;
  itemCount: number;
  currencyCode: string | null;
  totalMinor: number;
  payUrlBase: string | null;
  orderRef: string;
}

/** The pay link: the base with the order appended (`?order=` or `&order=`); empty when no base is set. */
export function payUrl(base: string | null, orderRef: string): string {
  if (!base) return '';
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${trimmed.includes('?') ? '&' : '?'}order=${orderRef}`;
}

/** "USD 12.50": the currency code, a space, the major amount with two decimals and comma grouping. */
export function ackTotal(currencyCode: string | null, totalMinor: number): string {
  const amount = (totalMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currencyCode ?? ''} ${amount}`.trim();
}

/** The built-in order-received text (WD-CAT-029). */
export function buildOrderAck(i: OrderAckInput): string {
  const name = (i.customerName ?? '').trim() || 'there';
  const link = payUrl(i.payUrlBase, i.orderRef);
  return [
    `Thank you, ${name}! We've received your order #${i.orderNumber}.`,
    `${i.itemCount} item${i.itemCount === 1 ? '' : 's'} · Total: ${ackTotal(i.currencyCode, i.totalMinor)}`,
    link !== ''
      ? `Complete your payment securely here: ${link}`
      : "We'll confirm your order and share payment details shortly.",
  ].join('\n');
}

/**
 * A cart sent from a WhatsApp catalog (`type=order`) as an order (WD-WABA-042). Pure: the service looks the products up and writes.
 */

type Raw = Record<string, unknown>;

export interface CartLine {
  retailerId: string;
  quantity: number;
  /** Meta sends a decimal in major units; stored in minor units. */
  priceMinor: number;
  currency: string | null;
}

export interface CartOrder {
  catalogId: string | null;
  note: string | null;
  lines: CartLine[];
  totalMinor: number;
  currency: string;
}

export const isOrderMessage = (message: Raw): boolean => message.type === 'order';

/** `round(price x 100)` per unit, then the quantity: 10.99 x 2 + 5.00 x 1 is 2698. Currency is the last line's, INR when none says. */
export function cartOf(message: Raw): CartOrder | null {
  const order = message.order as
    { catalog_id?: string; text?: string; product_items?: Raw[] } | undefined;
  const lines: CartLine[] = [];
  for (const it of order?.product_items ?? []) {
    const retailerId = String(it.product_retailer_id ?? '').trim();
    if (!retailerId) continue;
    const quantity = Math.max(1, Math.trunc(Number(it.quantity ?? 1)) || 1);
    lines.push({
      retailerId,
      quantity,
      priceMinor: Math.round(Number(it.item_price ?? 0) * 100) || 0,
      currency: typeof it.currency === 'string' && it.currency ? it.currency.toUpperCase() : null,
    });
  }
  if (lines.length === 0) return null;
  return {
    catalogId: order?.catalog_id ?? null,
    note: order?.text?.trim() || null,
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.priceMinor * l.quantity, 0),
    currency: [...lines].reverse().find((l) => l.currency)?.currency ?? 'INR',
  };
}

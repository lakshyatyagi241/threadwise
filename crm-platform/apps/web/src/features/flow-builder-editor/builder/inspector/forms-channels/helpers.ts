import type { FlbCommerceProduct } from '@crm/contracts';

/** What a commerce node stores per product (WaDesk's shape, kept so exports and imports stay compatible). */
export interface ProductItem {
  retailer_id: string;
  name: string;
  image: string | null;
  price_minor: number | null;
  currency: string | null;
}

/** WaDesk caps a commerce node at 30 products. */
export const MAX_PRODUCT_ITEMS = 30;

export function toProductItem(p: FlbCommerceProduct): ProductItem {
  return {
    retailer_id: p.retailerId,
    name: p.name,
    image: p.image,
    price_minor: p.priceMinor,
    currency: p.currency,
  };
}

/** Reads `productItems` defensively: a hand-edited or imported flow can carry anything. */
export function readProductItems(value: unknown): ProductItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      retailer_id: String(v.retailer_id ?? ''),
      name: String(v.name ?? ''),
      image: typeof v.image === 'string' && v.image ? v.image : null,
      price_minor: typeof v.price_minor === 'number' ? v.price_minor : null,
      currency: typeof v.currency === 'string' && v.currency ? v.currency : null,
    }));
}

/** Appends picked products the node does not hold yet, capped like WaDesk. */
export function mergePicked(current: ProductItem[], picked: ProductItem[]): ProductItem[] {
  const seen = new Set(current.map((p) => p.retailer_id));
  const added = picked.filter((p) => !seen.has(p.retailer_id));
  return current.concat(added).slice(0, MAX_PRODUCT_ITEMS);
}

/** `USD 9.99`, or an em dash when the product has no price. */
export function formatPrice(currency: string | null | undefined, priceMinor: number | null | undefined): string {
  const amount = priceMinor ? (priceMinor / 100).toFixed(2) : '—';
  return `${currency ?? ''} ${amount}`.trim();
}

/** Pulls the id out of a pasted Google URL (`/d/<id>/edit`); a bare id is kept as typed. */
export function extractGoogleId(input: string): string {
  const v = input.trim();
  const m = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1]! : v;
}

/**
 * Options for a dropdown backed by reference data. A saved id that is no longer in the list stays selectable (labelled)
 * so opening a node never silently drops its value.
 */
export function withSavedOption(
  options: { v: string; l: string }[],
  saved: unknown,
  savedLabel: (id: string) => string,
): { v: string; l: string }[] {
  const id = saved === null || saved === undefined ? '' : String(saved);
  if (!id || options.some((o) => o.v === id)) return options;
  return [...options, { v: id, l: savedLabel(id) }];
}

/** Truthy unless explicitly `false` (WaDesk's `d.x !== false` defaults). */
export const onUnlessFalse = (v: unknown): boolean => v !== false;

import type { StoreRead, StoreRecord, WooStoreApi } from '../../infra/providers/ecom/ecom.port';

/** A variable product lists only its variation ids; the variations themselves are a read of their own. */
export const isVariableProduct = (p: StoreRecord): boolean =>
  p.type === 'variable' && Array.isArray(p.variations) && p.variations.length > 0;

/**
 * The product with its variations attached as `_variations` (what `wooProduct` reads). A store that does not answer leaves the
 * product as it came, so it still imports as a plain product (and `complete` says the variations were cut short).
 */
export async function withWooVariations(
  api: Pick<WooStoreApi, 'variations'>,
  p: StoreRecord,
): Promise<{ product: StoreRecord; complete: boolean }> {
  if (!isVariableProduct(p)) return { product: p, complete: true };
  const read = await api.variations(String(p.id));
  return read.items.length > 0
    ? { product: { ...p, _variations: read.items }, complete: read.complete }
    : { product: p, complete: false };
}

/** A product read in which every variable product carries its variations. */
export async function readWooProducts(
  api: Pick<WooStoreApi, 'products' | 'variations'>,
): Promise<StoreRead> {
  const base = await api.products();
  const items: StoreRecord[] = [];
  let complete = base.complete;
  for (const p of base.items) {
    const r = await withWooVariations(api, p);
    items.push(r.product);
    if (!r.complete) complete = false;
  }
  return { items, complete };
}

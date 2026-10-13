import { variantTitle, type ProductVariantInput } from '@crm/contracts';

/**
 * Pure rules of product variants: the aggregate the product row keeps for older readers (invariant 1), the stored form of a
 * variant at write time (invariant 2), how a form's variant list is diffed against the stored one, and the variant's retailer id
 * (invariant 5). No I/O, so each is unit-tested.
 */

export interface VariantStock {
  /** The price the variant sells at; null reads as the product's price. */
  priceMinor: number | null;
  stockQty: number | null;
  reservedQty: number;
  active: boolean;
}

export interface ProductAggregate {
  priceMinor: number;
  /** Null when any active variant is unlimited. */
  stockQty: number | null;
  reservedQty: number;
  inStock: boolean;
}

/** Whether a variant can be bought now: active, and unlimited or with something not held. */
export const variantSellable = (
  v: Pick<VariantStock, 'stockQty' | 'reservedQty' | 'active'>,
): boolean => v.active && (v.stockQty === null || v.stockQty - (v.reservedQty || 0) > 0);

/**
 * What the product row holds while it has variants: the lowest effective price of the ACTIVE variants (of all of them when none is
 * active), the sum of the active variants' stock (null when any is unlimited, 0 when none is active), every variant's holds, and
 * "in stock" when any variant is sellable. Null when there are no variants: the product then keeps its own values.
 */
export function computeAggregate(
  variants: readonly VariantStock[],
  productPriceMinor: number,
): ProductAggregate | null {
  if (variants.length === 0) return null;
  const active = variants.filter((v) => v.active);
  const priced = (active.length > 0 ? active : variants).map(
    (v) => v.priceMinor ?? productPriceMinor,
  );
  const stockQty = active.some((v) => v.stockQty === null)
    ? null
    : active.reduce((sum, v) => sum + (v.stockQty ?? 0), 0);
  return {
    priceMinor: Math.min(...priced),
    stockQty,
    reservedQty: variants.reduce((sum, v) => sum + (v.reservedQty || 0), 0),
    inStock: variants.some(variantSellable),
  };
}

/** `variant.meta_retailer_id ?? variant.sku ?? <product retailer id>-<position + 1>` (Meta groups variants by the product's id). */
export function variantRetailerId(
  v: { metaRetailerId: string | null; sku: string | null; position: number },
  productRetailerId: string,
): string {
  return v.metaRetailerId || v.sku || `${productRetailerId}-${v.position + 1}`;
}

/** A variant as it is stored, from the form's input; `defaultPriceMinor` is the product form's price (invariant 2). */
export interface VariantWrite {
  title: string;
  optionValues: string[];
  sku: string | null;
  priceMinor: number;
  comparePriceMinor: number | null;
  imageUrl: string | null;
  weightGrams: number | null;
  stockQty: number | null;
  active: boolean;
  position: number;
}

export function toVariantWrite(
  input: ProductVariantInput,
  position: number,
  defaultPriceMinor: number,
  majorToMinor: (major: string) => number,
): VariantWrite {
  const sku = (input.sku ?? '').trim();
  const compare = input.comparePriceMajor == null ? null : majorToMinor(input.comparePriceMajor);
  return {
    title: variantTitle(input.optionValues),
    optionValues: input.optionValues,
    sku: sku === '' ? null : sku,
    priceMinor:
      input.priceMajor == null || input.priceMajor === ''
        ? defaultPriceMinor
        : majorToMinor(input.priceMajor),
    // Like the product: a compare price of 0 means none.
    comparePriceMinor: compare ? compare : null,
    imageUrl: input.imageUrl ? input.imageUrl : null,
    weightGrams: input.weightGrams ?? null,
    stockQty: input.stockQty ?? null,
    active: input.active ?? true,
    position,
  };
}

export interface StoredVariant extends VariantWrite {
  id: number;
  uuid: string;
}

export interface VariantDiff {
  /** Kept variants: the stored one and what it becomes; `changed` is false when nothing differs. */
  keep: Array<{ stored: StoredVariant; next: VariantWrite; changed: boolean }>;
  insert: Array<{ next: VariantWrite; inputIndex: number }>;
  remove: StoredVariant[];
  /** Input `id`s that name no stored variant (a stale form, or another product's id). */
  unknownIds: string[];
}

const sameWrite = (a: VariantWrite, b: VariantWrite): boolean =>
  a.title === b.title &&
  a.sku === b.sku &&
  a.priceMinor === b.priceMinor &&
  a.comparePriceMinor === b.comparePriceMinor &&
  a.imageUrl === b.imageUrl &&
  a.weightGrams === b.weightGrams &&
  a.stockQty === b.stockQty &&
  a.active === b.active &&
  a.position === b.position &&
  JSON.stringify(a.optionValues) === JSON.stringify(b.optionValues);

/**
 * Diffs the form's variants against the stored ones by variant uuid: a listed id is kept and updated, an unlisted stored variant is
 * removed, an input without an id is new. An id-less input whose title equals a stored variant nobody claimed by id keeps that variant
 * (an API client that does not echo ids must not lose stock and holds on every save).
 */
export function diffVariants(
  stored: readonly StoredVariant[],
  inputs: ReadonlyArray<{ id?: string | undefined; write: VariantWrite }>,
): VariantDiff {
  const byUuid = new Map(stored.map((s) => [s.uuid, s]));
  const claimed = new Set<string>();
  const unknownIds: string[] = [];
  for (const i of inputs) {
    if (!i.id) continue;
    if (byUuid.has(i.id)) claimed.add(i.id);
    else unknownIds.push(i.id);
  }
  const unclaimedByTitle = new Map(
    stored.filter((s) => !claimed.has(s.uuid)).map((s) => [s.title.toLowerCase(), s]),
  );
  const keep: VariantDiff['keep'] = [];
  const insert: VariantDiff['insert'] = [];
  inputs.forEach((i, inputIndex) => {
    let match = i.id ? byUuid.get(i.id) : undefined;
    if (!match && !i.id) {
      const byTitle = unclaimedByTitle.get(i.write.title.toLowerCase());
      if (byTitle && !claimed.has(byTitle.uuid)) {
        match = byTitle;
        claimed.add(byTitle.uuid);
      }
    }
    if (match) keep.push({ stored: match, next: i.write, changed: !sameWrite(match, i.write) });
    else if (!i.id) insert.push({ next: i.write, inputIndex });
  });
  return { keep, insert, remove: stored.filter((s) => !claimed.has(s.uuid)), unknownIds };
}

import type { PublicProduct, PublicVariant } from '@crm/contracts';

/**
 * Product variants on the public shop (size, colour...). Everything here is pure: the picker, the card, the cart and the tests share
 * it. A product with variants has `options` (what the buyer picks) and `variants` (every buyable combination, with its own price,
 * image, SKU and stock). A product without variants never reaches any of these branches.
 */
type WithVariants = Pick<PublicProduct, 'variants' | 'options'>;

export const hasVariants = (p: WithVariants | undefined | null): boolean =>
  Boolean(p && p.options && p.options.length > 0 && p.variants && p.variants.length > 0);

/** A tracked stock of 0 (or less) cannot be bought; null means unlimited. */
export const variantSoldOut = (v: Pick<PublicVariant, 'stockQty'>): boolean =>
  v.stockQty !== null && v.stockQty <= 0;

/** Every variant is sold out. A product without variants is never judged here. */
export const allVariantsSoldOut = (p: WithVariants): boolean =>
  hasVariants(p) && p.variants!.every(variantSoldOut);

/** One chosen value per option (null = not chosen yet), in option order. */
export type Selection = ReadonlyArray<string | null>;

export const emptySelection = (p: WithVariants): Selection => (p.options ?? []).map(() => null);

export const selectionComplete = (sel: Selection): boolean =>
  sel.length > 0 && sel.every((v) => v !== null);

const sameValues = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v.toLowerCase() === b[i]!.toLowerCase());

/** The variant a full selection names, or undefined when it is incomplete or no such combination exists. */
export function findVariant(p: WithVariants, sel: Selection): PublicVariant | undefined {
  if (!hasVariants(p) || !selectionComplete(sel)) return undefined;
  return p.variants!.find((v) => sameValues(v.optionValues, sel as string[]));
}

export interface ValueState {
  /** Some variant has this value together with the other chosen values. */
  exists: boolean;
  /** ...and at least one such variant can still be bought. */
  available: boolean;
}

/** Whether `value` of option `index` can be bought, given what is chosen for the other options (sold-out values are struck through). */
export function valueState(
  p: WithVariants,
  sel: Selection,
  index: number,
  value: string,
): ValueState {
  const match = (p.variants ?? []).filter(
    (v) =>
      (v.optionValues[index] ?? '').toLowerCase() === value.toLowerCase() &&
      sel.every(
        (chosen, i) =>
          i === index ||
          chosen === null ||
          (v.optionValues[i] ?? '').toLowerCase() === chosen.toLowerCase(),
      ),
  );
  return { exists: match.length > 0, available: match.some((v) => !variantSoldOut(v)) };
}

/** The first option whose value is still missing (for the "Choose a size" prompt), or -1. */
export const firstMissingOption = (sel: Selection): number => sel.findIndex((v) => v === null);

/** What a card shows: the lowest price among buyable variants (all of them when everything is sold out) and whether prices differ. */
export function fromPrice(p: PublicProduct): { minor: number; display: string; varies: boolean } {
  if (!hasVariants(p)) return { minor: p.priceMinor, display: p.priceDisplay, varies: false };
  const vs = p.variants!;
  const pool = vs.filter((v) => !variantSoldOut(v));
  const list = pool.length > 0 ? pool : vs;
  const best = list.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
  const varies = vs.some((v) => v.priceMinor !== best.priceMinor);
  return { minor: best.priceMinor, display: best.priceDisplay, varies };
}

/** Count for the card's "N options" hint: the variants a buyer can pick between. */
export const variantCount = (p: WithVariants): number => (hasVariants(p) ? p.variants!.length : 0);

/** The selection that matches a variant (used to restore the picker from a cart line). */
export const selectionOf = (v: Pick<PublicVariant, 'optionValues'>): Selection => [
  ...v.optionValues,
];

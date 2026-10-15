import {
  OPTION_NAME_MAX,
  OPTION_VALUE_MAX,
  PRODUCT_OPTIONS_MAX,
  PRODUCT_OPTION_VALUES_MAX,
  PRODUCT_PRICE_MAX,
  PRODUCT_VARIANTS_MAX,
  combineOptionValues,
  trimLikeThreadwise,
  variantTitle,
  type ProductResponse,
  type ProductVariantInput,
} from '@crm/contracts';

/**
 * The pure half of the Variants section of the product form: the draft model, regenerating the variant table from the options
 * (keeping what was typed for combinations that survive), the checks that mirror the contract, and the part of the request body
 * that carries options and variants. Variants are an owner-approved extension; Reference has none.
 */

export interface OptionDraft {
  name: string;
  values: string[];
}

export interface VariantRow {
  /** Present for a variant that exists on the server: sent back so it is updated, not recreated. */
  id?: string;
  /** One value per option, in option order. */
  optionValues: string[];
  sku: string;
  /** Blank follows the product price. */
  priceMajor: string;
  /** Blank = unlimited. */
  stockQty: string;
  imageUrl: string;
  active: boolean;
  /** Not edited here; carried through so saving the form does not clear what the API or an import set. */
  comparePriceMajor: string;
  weightGrams: string;
}

export interface VariantsState {
  enabled: boolean;
  options: OptionDraft[];
  rows: VariantRow[];
}

export const EMPTY_VARIANTS: VariantsState = { enabled: false, options: [], rows: [] };

export const OPTION_NAME_SUGGESTIONS = ['size', 'colour', 'material', 'style'] as const;
export type OptionNameSuggestion = (typeof OPTION_NAME_SUGGESTIONS)[number];

/** One-click value sets for an option (clothing sizes and numeric shoe sizes). */
export const VALUE_PRESETS = {
  clothing: ['XS', 'S', 'M', 'L', 'XL'],
  shoes: ['6', '7', '8', '9', '10', '11', '12'],
} as const;
export type PresetKey = keyof typeof VALUE_PRESETS;
export const PRESET_KEYS = Object.keys(VALUE_PRESETS) as PresetKey[];

export const MAX_OPTIONS = PRODUCT_OPTIONS_MAX;

const fixed2 = (major: string | null): string => {
  if (!major) return '';
  const n = Number(major);
  return Number.isFinite(n) ? n.toFixed(2) : major;
};

export function variantsFromProduct(p: ProductResponse): VariantsState {
  if (!p.hasVariants) return EMPTY_VARIANTS;
  return {
    enabled: true,
    options: p.options.map((o) => ({ name: o.name, values: [...o.values] })),
    rows: p.variants.map((v) => ({
      id: v.id,
      optionValues: [...v.optionValues],
      sku: v.sku ?? '',
      priceMajor: fixed2(v.priceOverrideMajor),
      stockQty: v.stockQty === null ? '' : String(v.stockQty),
      imageUrl: v.imageUrl ?? '',
      active: v.active,
      comparePriceMajor: fixed2(v.comparePriceMajor),
      weightGrams: v.weightGrams === null ? '' : String(v.weightGrams),
    })),
  };
}

const lower = (s: string) => trimLikeThreadwise(s).toLowerCase();

/** A combination as a set of "option=value" pairs, so reordering the options still finds the same variant. */
function pairKey(options: readonly OptionDraft[], values: readonly string[]): string {
  return values
    .map((v, i) => `${lower(options[i]?.name ?? '')}\u0001${lower(v)}`)
    .sort()
    .join('\u0000');
}
const titleKey = (values: readonly string[]) => values.map(lower).join('\u0000');

export function newRow(optionValues: string[]): VariantRow {
  return {
    optionValues,
    sku: '',
    priceMajor: '',
    stockQty: '',
    imageUrl: '',
    active: true,
    comparePriceMajor: '',
    weightGrams: '',
  };
}

/** Whether a row carries anything the person typed or that exists on the server (so dropping it deserves a confirm). */
export const rowHasData = (r: VariantRow): boolean =>
  Boolean(r.id) || Boolean(r.sku || r.priceMajor || r.stockQty || r.imageUrl) || !r.active;

export interface Regenerated {
  rows: VariantRow[];
  /** Old rows whose combination no longer exists. */
  dropped: VariantRow[];
}

/**
 * The variant table for `next` options: every combination, in option order. A combination that existed before keeps its row and
 * what was entered, matched by option name and value (so reordering options is safe) and then by the title ("M / Red").
 * While any option has no values the table is left unchanged.
 */
export function regenerateRows(
  prevOptions: readonly OptionDraft[],
  prevRows: readonly VariantRow[],
  next: readonly OptionDraft[],
): Regenerated {
  // An option with no values yet (just added, or being retyped) leaves the table as it is: nothing is dropped half way.
  if (next.length === 0 || next.some((o) => o.values.length === 0))
    return { rows: [...prevRows], dropped: [] };
  const combos = combineOptionValues(next);
  const byPair = new Map<string, VariantRow>();
  const byTitle = new Map<string, VariantRow>();
  for (const r of prevRows) {
    byPair.set(pairKey(prevOptions, r.optionValues), r);
    byTitle.set(titleKey(r.optionValues), r);
  }
  const used = new Set<VariantRow>();
  const rows = combos.map((values) => {
    const old = byPair.get(pairKey(next, values)) ?? byTitle.get(titleKey(values));
    if (old && !used.has(old)) {
      used.add(old);
      return { ...old, optionValues: values };
    }
    return newRow(values);
  });
  return { rows, dropped: prevRows.filter((r) => !used.has(r)) };
}

/** What a dropped-rows confirm needs: only rows that hold something worth losing. */
export const droppedWithData = (r: Regenerated): VariantRow[] => r.dropped.filter(rowHasData);

/** Adds a preset's values to an option, skipping repeats (any case) and respecting the per-option limit. */
export function withPreset(values: readonly string[], preset: PresetKey): string[] {
  const out = [...values];
  const seen = new Set(out.map(lower));
  for (const v of VALUE_PRESETS[preset]) {
    if (out.length >= PRODUCT_OPTION_VALUES_MAX) break;
    if (!seen.has(lower(v))) {
      seen.add(lower(v));
      out.push(v);
    }
  }
  return out;
}

export type AddValueResult =
  { ok: true; values: string[] } | { ok: false; reason: 'empty' | 'tooLong' | 'dup' | 'tooMany' };

/** One typed value added to an option (Enter or comma). A repeat is refused rather than silently dropped. */
export function addValue(values: readonly string[], raw: string): AddValueResult {
  const v = trimLikeThreadwise(raw);
  if (!v) return { ok: false, reason: 'empty' };
  if (v.length > OPTION_VALUE_MAX) return { ok: false, reason: 'tooLong' };
  if (values.some((x) => lower(x) === v.toLowerCase())) return { ok: false, reason: 'dup' };
  if (values.length >= PRODUCT_OPTION_VALUES_MAX) return { ok: false, reason: 'tooMany' };
  return { ok: true, values: [...values, v] };
}

/** "S, M, L" typed or pasted into the value box: every part added, repeats skipped. */
export function addValues(values: readonly string[], raw: string): string[] {
  let out = [...values];
  for (const part of raw.split(',')) {
    const r = addValue(out, part);
    if (r.ok) out = r.values;
  }
  return out;
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** Sets the price and/or stock of every row (the bulk-fill boxes). An empty string clears the field. */
export function bulkFill(
  rows: readonly VariantRow[],
  fill: { priceMajor?: string; stockQty?: string },
): VariantRow[] {
  return rows.map((r) => ({
    ...r,
    ...(fill.priceMajor !== undefined ? { priceMajor: fill.priceMajor.trim() } : {}),
    ...(fill.stockQty !== undefined ? { stockQty: fill.stockQty.trim() } : {}),
  }));
}

export const variantCount = (s: Pick<VariantsState, 'options'>): number =>
  s.options.length === 0 || s.options.some((o) => o.values.length === 0)
    ? 0
    : s.options.reduce((n, o) => n * o.values.length, 1);

export interface StockTotal {
  /** Sum of the active variants that have a quantity. */
  total: number;
  /** Any active variant is unlimited, so the product is too. */
  unlimited: boolean;
}

/** The aggregate the product row will hold: the active variants' stock, unlimited as soon as one of them is. */
export function stockTotal(rows: readonly VariantRow[]): StockTotal {
  let total = 0;
  let unlimited = false;
  for (const r of rows) {
    if (!r.active) continue;
    if (!r.stockQty.trim()) unlimited = true;
    else total += Number.parseInt(r.stockQty.trim(), 10) || 0;
  }
  return { total, unlimited };
}

/** The lowest price an active variant sells at (blank follows `productPriceMajor`); null when nothing is priced. */
export function fromPrice(rows: readonly VariantRow[], productPriceMajor: string): number | null {
  const base = Number.parseFloat(productPriceMajor);
  let low: number | null = null;
  for (const r of rows) {
    if (!r.active) continue;
    const own = r.priceMajor.trim() ? Number.parseFloat(r.priceMajor) : base;
    if (!Number.isFinite(own)) continue;
    if (low === null || own < low) low = own;
  }
  return low;
}

export const VARIANT_PROBLEM_KEYS = [
  'required',
  'tooLong',
  'dupName',
  'dupValue',
  'needOption',
  'needValue',
  'tooManyValues',
  'tooManyVariants',
  'notNumber',
  'tooBig',
  'notWhole',
  'outOfRange',
  'badUrl',
] as const;
export type VariantProblem = (typeof VARIANT_PROBLEM_KEYS)[number];

export interface OptionProblems {
  name?: VariantProblem;
  values?: VariantProblem;
}
export interface RowProblems {
  sku?: VariantProblem;
  priceMajor?: VariantProblem;
  stockQty?: VariantProblem;
  imageUrl?: VariantProblem;
}
export interface VariantProblems {
  /** Whole-section problems: no option, too many variants. */
  general?: VariantProblem;
  options: OptionProblems[];
  rows: RowProblems[];
}

const AMOUNT = /^(\d+(\.\d+)?|\.\d+)$/;
const WHOLE = /^(0|[1-9]\d*)$/;

function priceProblem(v: string): VariantProblem | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (!AMOUNT.test(t)) return 'notNumber';
  const n = Number(t);
  if (n > PRODUCT_PRICE_MAX) return 'tooBig';
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return 'notNumber';
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Field checks mirroring the contract (names and values unique, limits, numeric prices, whole stock, https links). */
export function validateVariants(state: VariantsState): VariantProblems {
  const out: VariantProblems = { options: [], rows: [] };
  if (!state.enabled) return out;
  if (state.options.length === 0) out.general = 'needOption';
  const names = new Set<string>();
  state.options.forEach((o, i) => {
    const p: OptionProblems = {};
    const name = trimLikeThreadwise(o.name);
    if (!name) p.name = 'required';
    else if (name.length > OPTION_NAME_MAX) p.name = 'tooLong';
    else if (names.has(name.toLowerCase())) p.name = 'dupName';
    names.add(name.toLowerCase());
    if (o.values.length === 0) p.values = 'needValue';
    else if (o.values.length > PRODUCT_OPTION_VALUES_MAX) p.values = 'tooManyValues';
    else {
      const seen = new Set<string>();
      for (const v of o.values) {
        const t = trimLikeThreadwise(v);
        if (!t) p.values = 'required';
        else if (t.length > OPTION_VALUE_MAX) p.values = 'tooLong';
        else if (seen.has(t.toLowerCase())) p.values = 'dupValue';
        seen.add(t.toLowerCase());
      }
    }
    out.options[i] = p;
  });
  if (!out.general && variantCount(state) > PRODUCT_VARIANTS_MAX) out.general = 'tooManyVariants';
  state.rows.forEach((r, i) => {
    const p: RowProblems = {};
    if (trimLikeThreadwise(r.sku).length > 96) p.sku = 'tooLong';
    const price = priceProblem(r.priceMajor);
    if (price) p.priceMajor = price;
    const stock = r.stockQty.trim();
    if (stock) {
      if (!WHOLE.test(stock)) p.stockQty = 'notWhole';
      else if (Number(stock) > 1_000_000) p.stockQty = 'outOfRange';
    }
    const image = trimLikeThreadwise(r.imageUrl);
    if (image && (image.length > 1024 || !isHttpUrl(image))) p.imageUrl = 'badUrl';
    out.rows[i] = p;
  });
  return out;
}

export function hasVariantProblems(p: VariantProblems): boolean {
  return (
    p.general !== undefined ||
    p.options.some((o) => Object.keys(o).length > 0) ||
    p.rows.some((r) => Object.keys(r).length > 0)
  );
}

const amount = (v: string): string => {
  const t = v.trim();
  return /^\d+(\.\d{1,2})?$/.test(t) ? t : String(Number(t));
};
const int = (v: string): number | null => (v.trim() ? Number.parseInt(v.trim(), 10) : null);

export interface VariantsBody {
  options?: { name: string; values: string[] }[];
  variants?: ProductVariantInput[];
}

/**
 * The options and variants of the request. Turned off: nothing on create, and `options: []` on an edit of a product that had
 * variants (the API then removes them). Blank price follows the product; blank stock is unlimited (sent as null).
 */
export function buildVariantsBody(state: VariantsState, hadVariants: boolean): VariantsBody {
  if (!state.enabled) return hadVariants ? { options: [] } : {};
  return {
    options: state.options.map((o) => ({
      name: trimLikeThreadwise(o.name),
      values: o.values.map(trimLikeThreadwise),
    })),
    variants: state.rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      optionValues: r.optionValues.map(trimLikeThreadwise),
      sku: trimLikeThreadwise(r.sku) || null,
      priceMajor: r.priceMajor.trim() ? amount(r.priceMajor) : null,
      comparePriceMajor: r.comparePriceMajor.trim() ? amount(r.comparePriceMajor) : null,
      imageUrl: trimLikeThreadwise(r.imageUrl) || null,
      weightGrams: int(r.weightGrams),
      stockQty: int(r.stockQty),
      active: r.active,
    })),
  };
}

export type VariantPath =
  | { kind: 'option'; index: number; field: 'name' | 'values' }
  | { kind: 'row'; index: number; field: keyof RowProblems | 'other' }
  | { kind: 'general' };

/** A server field path (`options.1.values.0`, `variants.2.priceMajor`) as the place in the section it belongs to; null for other fields. */
export function variantPathOf(path: string): VariantPath | null {
  const [head, idx, field] = path.split('.');
  if (head === 'options' || head === 'variants') {
    const index = Number(idx);
    if (!Number.isInteger(index))
      return head === 'options' || head === 'variants' ? { kind: 'general' } : null;
    if (head === 'options')
      return { kind: 'option', index, field: field === 'name' ? 'name' : 'values' };
    const known = ['sku', 'priceMajor', 'stockQty', 'imageUrl'] as const;
    return {
      kind: 'row',
      index,
      field: (known as readonly string[]).includes(field ?? '')
        ? (field as keyof RowProblems)
        : 'other',
    };
  }
  return null;
}

export const rowTitle = (r: Pick<VariantRow, 'optionValues'>): string =>
  variantTitle(r.optionValues);

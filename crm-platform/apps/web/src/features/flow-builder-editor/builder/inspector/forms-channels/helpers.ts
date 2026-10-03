import type { FlbCommerceProduct } from '@crm/contracts';

/**
 * What a commerce node stores per product: WaDesk's picker saves the whole product it listed (WaDesk's key names, kept so
 * exports and imports stay compatible and the runtime reads `url` for the checkout card).
 */
export interface ProductItem {
  id: string;
  retailer_id: string;
  name: string;
  sku: string;
  image: string | null;
  price_minor: number | null;
  currency: string | null;
  url: string;
  in_stock: boolean;
}

/** WaDesk caps a commerce node at 30 products. */
export const MAX_PRODUCT_ITEMS = 30;

export function toProductItem(p: FlbCommerceProduct): ProductItem {
  return {
    id: p.id,
    retailer_id: p.retailerId,
    name: p.name,
    sku: p.sku ?? '',
    image: p.image,
    price_minor: p.priceMinor,
    currency: p.currency,
    url: p.url ?? '',
    in_stock: p.inStock,
  };
}

/** Reads `productItems` defensively: a hand-edited or imported flow can carry anything. */
export function readProductItems(value: unknown): ProductItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      id: String(v.id ?? ''),
      retailer_id: String(v.retailer_id ?? ''),
      name: String(v.name ?? ''),
      sku: String(v.sku ?? ''),
      image: typeof v.image === 'string' && v.image ? v.image : null,
      price_minor: typeof v.price_minor === 'number' ? v.price_minor : null,
      currency: typeof v.currency === 'string' && v.currency ? v.currency : null,
      url: String(v.url ?? ''),
      in_stock: v.in_stock !== false,
    }));
}

/** Appends picked products the node does not hold yet, capped like WaDesk. */
export function mergePicked(current: ProductItem[], picked: ProductItem[]): ProductItem[] {
  const seen = new Set(current.map((p) => p.retailer_id));
  const added = picked.filter((p) => !seen.has(p.retailer_id));
  return current.concat(added).slice(0, MAX_PRODUCT_ITEMS);
}

/** `USD 9.99`, or an em dash when the product has no price. */
export function formatPrice(
  currency: string | null | undefined,
  priceMinor: number | null | undefined,
): string {
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

/** A store option label: `Name · USD` when the store has a currency (WaDesk `name + (currency ? ' · ' + currency : '')`). */
export const storeLabel = (name: string, currency: string | null | undefined): string =>
  currency ? `${name} · ${currency}` : name;

/** A flow option label: `Name · live` / `Name · draft`, the way WaDesk's Sub-flow and hand-off pickers show a flow. */
export const flowOptionLabel = (name: string, isPublished: boolean): string =>
  `${name || 'Flow'}${isPublished ? ' · live' : ' · draft'}`;

/** A booking service label: `Name (inactive) · 30 min` (inactive and duration parts only when they apply). */
export const serviceLabel = (name: string, active: boolean, duration: number | null): string =>
  `${name}${active ? '' : ' (inactive)'}${duration ? ` · ${duration} min` : ''}`;

/** A form label: drafts are listed too and say so. */
export const formLabel = (title: string, isPublished: boolean): string =>
  `${title}${isPublished ? '' : ' (draft)'}`;

/**
 * Pipeline stage labels. WaDesk has one pipeline per workspace and shows the bare stage name; when the workspace has more
 * than one pipeline the stage carries its pipeline's name so two "Won" stages can be told apart.
 */
export function stageOptions(
  stages: ReadonlyArray<{ id: string; name: string; pipeline: string | null }>,
): { v: string; l: string }[] {
  const pipelines = new Set(stages.map((s) => s.pipeline ?? ''));
  const several = pipelines.size > 1;
  return stages.map((s) => ({
    v: s.id,
    l: several && s.pipeline ? `${s.pipeline} · ${s.name}` : s.name,
  }));
}

/** Flows a "hand off to WhatsApp" node may start: WaDesk hides the channels listed in `exclude` (and call flows). */
export function handoffFlows<T extends { flowType: string }>(
  flows: readonly T[],
  exclude: readonly string[],
): T[] {
  return flows.filter((f) => !exclude.includes(f.flowType) && f.flowType !== 'call');
}

/** An AI agent option: `Name · provider/model` when the agent has both (WaDesk), else just the name. */
export const agentOptionLabel = (
  name: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  id: string,
): string =>
  `${name || `Agent ${id.slice(0, 8)}`}${provider && model ? ` · ${provider}/${model}` : ''}`;

/** Where the Google Form node's Apps Script downloads from (same origin, the session cookie authorises it). */
export const appsScriptHref = (formId: string): string =>
  `/api/v2/flows/builder-context/google/forms/${encodeURIComponent(formId)}/apps-script`;

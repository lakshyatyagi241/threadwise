import { formatProductMoney } from '@crm/contracts';
import { metaCatalogPrice } from './catalog-money';

/**
 * The pure rules of the catalog domain: identities, availability, the Meta item payload, slugs, the health score, recipient
 * parsing and the wording of messages. No I/O here, so every rule has a unit test.
 */

// --- identity and availability (WD-CAT-009, 033) -----------------------------------------------------------------------------

export interface RetailerIdSource {
  id: number;
  sku: string | null;
  metaRetailerId: string | null;
}

/**
 * The id a product has on Meta and in a WhatsApp message: the stored retailer id, else the SKU, else `wsn-<id>`. Once used
 * it is Meta's permanent identity for the product, so it is stored on first push and never rotated.
 */
export function retailerIdOf(p: RetailerIdSource): string {
  return p.metaRetailerId || p.sku || `wsn-${p.id}`;
}

export interface AvailabilitySource {
  availability: string | null;
  status: string;
  stockQty: number | null;
}

/**
 * What Meta is told: the stored availability when there is one; otherwise derived from status and stock (a product that is
 * not active is `discontinued`, one with no stock left is `out of stock`, everything else `in stock`).
 */
export function effectiveAvailability(p: AvailabilitySource): string {
  if (p.availability) return p.availability;
  if (p.status !== 'active') return 'discontinued';
  if (p.stockQty !== null && p.stockQty <= 0) return 'out of stock';
  return 'in stock';
}

/** Sellable now: stock minus holds, never negative; null for unlimited stock. */
export function availableQty(stockQty: number | null, reservedQty: number): number | null {
  if (stockQty === null) return null;
  return Math.max(0, stockQty - (reservedQty || 0));
}

/** The availability words Meta may send, mapped onto the four values the column accepts (WD-CAT-011 rule 6). */
export function normalizeImportedAvailability(raw: string | null | undefined): string {
  const a = (raw ?? '').trim().toLowerCase();
  if (
    a === 'in stock' ||
    a === 'out of stock' ||
    a === 'available for order' ||
    a === 'discontinued'
  ) {
    return a;
  }
  if (a.includes('out')) return 'out of stock';
  if (a.includes('discontinu')) return 'discontinued';
  if (a.includes('order')) return 'available for order';
  return 'in stock';
}

// --- the Meta item (WD-CAT-033) ----------------------------------------------------------------------------------------------

export interface MetaItemSource extends RetailerIdSource, AvailabilitySource {
  name: string;
  slug: string;
  description: string | null;
  condition: string | null;
  priceMinor: number;
  currencyCode: string | null;
  imageUrl: string | null;
  galleryUrls: string[];
  productUrl: string | null;
  brand: string | null;
  category: string | null;
  googleProductCategory: string | null;
}

/**
 * The body Meta's `items_batch` takes for one product. Empty values are left out, as WaDesk's array filter did; the price is
 * converted to the currency's own minor unit; `url` is the product's own, else the shop's `/p/<slug>` page.
 */
export function buildMetaItem(p: MetaItemSource, shopUrl: string): Record<string, unknown> {
  const gallery = p.galleryUrls.filter((u) => u);
  const url = p.productUrl || (shopUrl ? `${shopUrl.replace(/\/+$/, '')}/p/${p.slug}` : null);
  const data: Record<string, unknown> = {
    retailer_id: retailerIdOf(p),
    name: p.name,
    description: Array.from(p.description ?? p.name)
      .slice(0, 9999)
      .join(''),
    availability: effectiveAvailability(p),
    condition: p.condition || 'new',
    price: metaCatalogPrice(p.priceMinor, p.currencyCode),
    currency: p.currencyCode || 'INR',
    image_url: p.imageUrl,
    additional_image_urls: gallery.length > 0 ? gallery : null,
    url,
    brand: p.brand,
    category: p.category,
    google_product_category: p.googleProductCategory,
    inventory: p.stockQty,
  };
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
}

// --- which edits are pushed (WD-CAT-012) -------------------------------------------------------------------------------------

/** A change to any of these is worth a re-push; slug, SKU, tags, gallery, sort order, weight and the `meta_*` bookkeeping are not. */
export const SYNC_FIELDS = [
  'name',
  'description',
  'priceMinor',
  'comparePriceMinor',
  'currencyCode',
  'imageUrl',
  'availability',
  'inStock',
  'stockQty',
  'brand',
  'category',
  'status',
] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

export function changedSyncFields(
  before: Partial<Record<SyncField, unknown>>,
  after: Partial<Record<SyncField, unknown>>,
): SyncField[] {
  return SYNC_FIELDS.filter((f) => before[f] !== after[f]);
}

/** The text stored with a failed row: WaDesk cut it at 500 characters. */
export const truncateError = (message: string): string =>
  Array.from(message).slice(0, 500).join('');

// --- slugs (WD-CAT-020, 017) ------------------------------------------------------------------------------------------------

/** WaDesk's `Str::slug`: ASCII letters and digits joined by single dashes. A name with none of them yields an empty string. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/@/g, ' at ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `base`, then `base-2`, `base-3`... the first one not in `taken`. */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  let slug = base;
  let i = 2;
  while (taken.has(slug)) slug = `${base}-${i++}`;
  return slug;
}

// --- the health score (WD-CAT-007) -------------------------------------------------------------------------------------------

/** Share of products that can sell as they are, 0 to 100; null when there are none (the card is then hidden). */
export function healthScore(total: number, flagged: number): number | null {
  if (total <= 0) return null;
  return Math.round(((total - flagged) / total) * 100);
}

// --- connect errors (WD-CAT-002) ---------------------------------------------------------------------------------------------

export const CATALOG_MANAGEMENT_HINT =
  ' — This usually means the access token is missing the "catalog_management" permission (a WhatsApp messaging token can SEND catalog messages but not READ the catalog), or the Catalog ID is wrong. Use a System-User token from Meta Business Manager that has catalog_management + business_management, and copy the Catalog ID from Commerce Manager.';

/**
 * What the operator reads when Meta refuses the verification: Meta's own message, `(code N)` or `(code N/subcode)`, and the hint
 * for code 100 or an "unsupported get request".
 */
export function metaRejectionMessage(meta: {
  raw: string | null;
  code: number | null;
  subcode: number | null;
}): string {
  const raw = (meta.raw ?? '').trim();
  const code = meta.code ?? 0;
  const sub = meta.subcode ?? 0;
  const hint =
    code === 100 || raw.toLowerCase().includes('unsupported get request')
      ? CATALOG_MANAGEMENT_HINT
      : '';
  return `Meta rejected verification: ${raw || 'unknown error'}${
    code ? ` (code ${code}${sub ? `/${sub}` : ''})` : ''
  }${hint}`;
}

// --- recipients (WD-CAT-014, 015) -------------------------------------------------------------------------------------------

export const MIN_RECIPIENT_DIGITS = 8;

export const digitsOf = (s: string | null | undefined): string => (s ?? '').replace(/\D+/g, '');

/**
 * A stored number as the digits to message: a `+` number is whole; otherwise the country code is put in front unless the local
 * digits already start with it (the same rule the broadcasts domain uses for recipients and senders).
 */
export function assemblePhone(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
): string {
  const local = digitsOf(phone);
  if (local === '') return '';
  if ((phone ?? '').trim().startsWith('+')) return local;
  const cc = digitsOf(countryCode);
  return cc !== '' && !local.startsWith(cc) ? `${cc}${local}` : local;
}

/** Pasted numbers split on whitespace, commas and semicolons; each reduced to digits and kept at 8 or more. */
export function parseManualNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const d = digitsOf(part);
    if (d.length >= MIN_RECIPIENT_DIGITS) out.push(d);
  }
  return out;
}

/** The sources merged in order (manual, contacts, groups), digits only, 8 or more, first occurrence wins. */
export function mergeRecipients(...sources: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of source) {
      const d = digitsOf(raw);
      if (d.length >= MIN_RECIPIENT_DIGITS) seen.add(d);
    }
  }
  return [...seen];
}

// --- message content (WD-CAT-015) -------------------------------------------------------------------------------------------

export interface SectionProduct {
  retailerId: string;
  category: string | null;
}

/** MPM sections: one per category in first-seen order, "Featured" for products with none. */
export function buildMpmSections(
  products: readonly SectionProduct[],
): Array<{ title: string; productRetailerIds: string[] }> {
  const sections = new Map<string, string[]>();
  for (const p of products) {
    const title = p.category || 'Featured';
    const list = sections.get(title) ?? [];
    list.push(p.retailerId);
    sections.set(title, list);
  }
  return [...sections].map(([title, productRetailerIds]) => ({ title, productRetailerIds }));
}

/** The default catalog-link text. WaDesk used the catalog's phone number id, else the RECIPIENT's number (kept as is). */
export function defaultCatalogLinkText(
  phoneNumberId: string | null,
  recipientDigits: string,
): string {
  return `Check out our catalog: https://wa.me/c/${digitsOf(phoneNumberId || recipientDigits)}`;
}

/** The caption of a single-product share (WD-CAT-023): name, price, a short description and the product link. */
export function productShareCaption(p: {
  name: string;
  priceMinor: number;
  currencyCode: string;
  description: string | null;
  link: string | null;
}): string {
  let caption = `*${p.name}* — ${formatProductMoney(p.priceMinor, p.currencyCode)}`;
  const desc = (p.description ?? '').trim();
  if (desc !== '') caption += `\n\n${Array.from(desc).slice(0, 300).join('')}`;
  if (p.link) caption += `\n\n${p.link}`;
  return caption;
}

/** The ready order text of the `wa.me` share link (WD-CAT-022). */
export function waOrderText(p: {
  name: string;
  priceMinor: number;
  currencyCode: string;
  imageUrl: string | null;
}): string {
  return `Hi! I want to order:\n\n*${p.name}* — ${formatProductMoney(p.priceMinor, p.currencyCode)}\n${
    p.imageUrl ? `${p.imageUrl}\n` : ''
  }\nQty: 1`;
}

/** Comma-separated tags to a unique, trimmed list (kept for the CSV form field of imports). */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter((t) => t !== ''))];
}

/** Gallery rows: blanks dropped, de-duplicated, at most 12 (WD-CAT-020). */
export function normalizeGallery(urls: readonly string[], max = 12): string[] {
  return [...new Set(urls.map((u) => u.trim()).filter((u) => u !== ''))].slice(0, max);
}

/** Pure: the submitted order kept, only owned ids, each once. */
export function ownedInSubmittedOrder<T extends { uuid: string }>(
  submitted: readonly string[],
  owned: readonly T[],
): T[] {
  const byUuid = new Map(owned.map((o) => [o.uuid, o]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const u of submitted) {
    const hit = byUuid.get(u);
    if (hit && !seen.has(u)) {
      seen.add(u);
      out.push(hit);
    }
  }
  return out;
}

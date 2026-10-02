import {
  CATALOG_SEND_MAX_PRODUCTS,
  CATALOG_SEND_MAX_RECIPIENTS,
  type CatalogSendMode,
  type SendCatalogInput,
  type SendCatalogResponse,
} from '@crm/contracts';

/** The pure half of the Send tab (WD-CAT-014): what is counted, what a click toggles, and what is posted. */

export const RECIPIENT_MODES = ['groups', 'contacts', 'manual'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];

export const MESSAGE_MAX = 1024;
export const HEADER_MAX = 60;
export const FOOTER_MAX = 60;

export interface SendForm {
  recipientMode: RecipientMode;
  groupIds: string[];
  contactIds: string[];
  manual: string;
  mode: CatalogSendMode;
  /** `<engine>:<uuid>`; empty lets the server pick the active sender. */
  sender: string;
  shopId: string;
  productIds: string[];
  body: string;
  header: string;
  footer: string;
}

export const EMPTY_SEND_FORM: SendForm = {
  recipientMode: 'groups',
  groupIds: [],
  contactIds: [],
  manual: '',
  mode: 'spm',
  sender: '',
  shopId: '',
  productIds: [],
  body: '',
  header: '',
  footer: '',
};

/** Numbers are separated by whitespace, commas or semicolons; a token counts when it holds 8 or more digits. */
export function manualNumbers(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((token) => token.replace(/\D+/g, ''))
    .filter((digits) => digits.length >= 8);
}

export const countManual = (text: string): number => manualNumbers(text).length;

/**
 * The live "N recipients" counter. Groups are summed, not de-duplicated (as WaDesk did), so it can exceed the total the
 * server sends to.
 */
export function recipientCount(form: SendForm, groupCounts: ReadonlyMap<string, number>): number {
  if (form.recipientMode === 'manual') return countManual(form.manual);
  if (form.recipientMode === 'contacts') return form.contactIds.length;
  return form.groupIds.reduce((sum, id) => sum + (groupCounts.get(id) ?? 0), 0);
}

/** The contact search box: a case-insensitive match on the name and the number. */
export function filterContacts<T extends { name: string | null; mobile: string | null }>(
  contacts: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return contacts;
  return contacts.filter((c) => `${c.name ?? ''} ${c.mobile ?? ''}`.toLowerCase().includes(needle));
}

export const overRecipientCap = (count: number): boolean => count > CATALOG_SEND_MAX_RECIPIENTS;

export type ToggleOutcome = { form: SendForm; refused: 'max' | null };

/**
 * Checking a product. Single product: one only (checking another replaces it). List: up to 30, the 31st is refused.
 * Unchecking always works.
 */
export function toggleProduct(form: SendForm, id: string): ToggleOutcome {
  if (form.productIds.includes(id)) {
    return {
      form: { ...form, productIds: form.productIds.filter((p) => p !== id) },
      refused: null,
    };
  }
  if (form.mode === 'spm') return { form: { ...form, productIds: [id] }, refused: null };
  if (form.productIds.length >= CATALOG_SEND_MAX_PRODUCTS) return { form, refused: 'max' };
  return { form: { ...form, productIds: [...form.productIds, id] }, refused: null };
}

/** Switching to single product keeps only the first pick. */
export function setMode(form: SendForm, mode: CatalogSendMode): SendForm {
  const productIds = mode === 'spm' ? form.productIds.slice(0, 1) : form.productIds;
  return { ...form, mode, productIds };
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export const SEND_LABEL: Record<CatalogSendMode, 'sendProduct' | 'sendCarousel' | 'sendLink'> = {
  spm: 'sendProduct',
  mpm: 'sendCarousel',
  link: 'sendLink',
};

/** The request: only the active recipient source is posted, and link mode posts no products (WaDesk's form did the same). */
export function buildSendRequest(form: SendForm): SendCatalogInput {
  const req: SendCatalogInput = {
    mode: form.mode,
    groupIds: [],
    contactIds: [],
    productIds: form.mode === 'link' ? [] : form.productIds,
  };
  if (form.recipientMode === 'manual') req.manualNumbers = form.manual;
  else if (form.recipientMode === 'contacts') req.contactIds = form.contactIds;
  else req.groupIds = form.groupIds;
  if (form.body.trim()) req.body = form.body;
  // A header belongs to a list message and a footer to a product message; a catalog link is plain text.
  if (form.mode === 'mpm' && form.header.trim()) req.header = form.header;
  if (form.mode !== 'link' && form.footer.trim()) req.footer = form.footer;
  if (form.sender) req.sender = form.sender;
  if (form.shopId) req.shopId = form.shopId;
  return req;
}

/** A send where nobody got the message is shown as a failure, with the first reasons. */
export const sendFailed = (res: SendCatalogResponse): boolean => !res.ok;

/** The products of the picker under their category, in the order each category first appears; no category reads `other`. */
export function groupByCategory<T extends { category: string | null }>(
  items: T[],
  other: string,
): Array<{ name: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = item.category?.trim() || other;
    const list = groups.get(name);
    if (list) list.push(item);
    else groups.set(name, [item]);
  }
  return [...groups].map(([name, list]) => ({ name, items: list }));
}

/** The shop the picker starts on (WaDesk: the newest). */
export const firstId = (items: Array<{ id: string }>): string => items[0]?.id ?? '';

/** The collection's "Send as MPM": a list message to one pasted number with the collection's live products. */
export function buildCollectionSend(input: {
  number: string;
  header: string;
  sender: string;
  productIds: string[];
}): SendCatalogInput {
  const req: SendCatalogInput = {
    mode: 'mpm',
    manualNumbers: input.number.trim(),
    groupIds: [],
    contactIds: [],
    productIds: input.productIds,
  };
  if (input.header.trim()) req.header = input.header.trim();
  if (input.sender) req.sender = input.sender;
  return req;
}

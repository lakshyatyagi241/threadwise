import { formatProductMoney, type OrderLine } from '@crm/contracts';

/**
 * The pure rules of natural-language ordering (TW-FLR-042): the wording of the summary and the confirmation, what a customer's reply
 * means, whether a "reply" is really a media placeholder, how the model's item list is read. No database, no vendor.
 */

export interface Unavailable {
  name: string;
  qty: number;
  reason: 'not_found' | 'out_of_stock';
  available?: number | null;
}

export const digitsOf = (s: string): string => s.replace(/\D+/g, '');

/** The stock-hold reference of a customer's cart (Reference `WaPendingOrder::refFor`). */
export const cartRef = (orgId: number, customerPhone: string): string =>
  `ord:${orgId}:${digitsOf(customerPhone)}`;

/** "only 2 in stock", "out of stock" or "not found". */
export function reasonText(u: Unavailable): string {
  if (u.reason !== 'out_of_stock') return 'not found';
  const left = Math.trunc(u.available ?? 0);
  return left > 0 ? `only ${left} in stock` : 'out of stock';
}

/** The customer-facing order summary in English (the caller localizes it). Nothing matched: an apology and why, no prompt. */
export function buildSummary(
  items: readonly OrderLine[],
  unavailable: readonly Unavailable[],
  totalMinor: number,
  currency: string | null,
): string {
  if (items.length === 0) {
    const lines = ["Sorry, we can't take that order right now:"];
    for (const u of unavailable) lines.push(`• ${u.qty} × ${u.name} — ${reasonText(u)}`);
    lines.push('', 'Please send your order again any time.');
    return lines.join('\n');
  }
  const lines = ['*Your order*'];
  for (const li of items) {
    lines.push(
      `• ${li.qty} × ${li.name} — ${formatProductMoney(li.price_minor * li.qty, li.currency ?? currency)}`,
    );
  }
  lines.push('', `*Total: ${formatProductMoney(totalMinor, currency)}*`);
  if (unavailable.length > 0) {
    lines.push('', '_Not available:_');
    for (const u of unavailable) lines.push(`• ${u.qty} × ${u.name} — ${reasonText(u)}`);
  }
  return lines.join('\n');
}

/** The recap posted to the group and sent back to the customer after Confirm. */
export function buildConfirmedText(
  orderId: number,
  items: readonly OrderLine[],
  totalMinor: number,
  currency: string | null,
  ship: { name?: string | null; company?: string | null; address?: string | null } = {},
): string {
  const lines = [`*New order #${orderId}*`];
  for (const li of items) lines.push(`• ${li.qty} × ${li.name}`);
  lines.push(`*Total: ${formatProductMoney(totalMinor, currency)}*`);
  const where = [ship.name, ship.company, ship.address]
    .map((v) => (v ?? '').trim())
    .filter((v) => v !== '')
    .join(', ');
  if (where !== '') lines.push(`*Ship to:* ${where}`);
  return lines.join('\n');
}

export type ReplyIntent = 'confirm' | 'cancel' | 'unclear';

const STRONG_CONFIRM =
  /\b(confirm|confirmed|confirming|proceed|place\s+(the\s+)?order|go\s+ahead)\b/u;
const STRONG_CANCEL = /\b(cancel|canceled|cancelled|abort|discard)\b/u;
const WEAK_CONFIRM = /\b(yes|yeah|yep|yup|ok|okay|sure|correct)\b/u;
const WEAK_CANCEL = /\b(no|nope|stop|don'?t)\b/u;

/**
 * What a reply means, from its English translation. Decisive words count anywhere; weak words (yes, no, ok, stop) only in a reply of
 * four words or fewer, so an incidental "no" in a long message never cancels an order. Anything else is unclear and gets asked again.
 */
export function intentOf(english: string): ReplyIntent {
  const en = english.trim().toLowerCase();
  const words = en.split(/\s+/u).filter((w) => w !== '').length;
  const short = words <= 4;
  if (STRONG_CONFIRM.test(en)) return 'confirm';
  if (STRONG_CANCEL.test(en)) return 'cancel';
  if (short && WEAK_CONFIRM.test(en)) return 'confirm';
  if (short && WEAK_CANCEL.test(en)) return 'cancel';
  return 'unclear';
}

/** The offline safety net when translation is down: the most common confirm and cancel words in other scripts, as English. */
const OFFLINE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['确认', 'confirm'],
  ['確認', 'confirm'],
  ['确定', 'confirm'],
  ['下单', 'confirm'],
  ['是', 'yes'],
  ['好', 'ok'],
  ['可以', 'ok'],
  ['はい', 'yes'],
  ['確定', 'confirm'],
  ['확인', 'confirm'],
  ['네', 'yes'],
  ['نعم', 'yes'],
  ['تأكيد', 'confirm'],
  ['हाँ', 'yes'],
  ['取消', 'cancel'],
  ['不要', 'cancel'],
  ['不', 'no'],
  ['キャンセル', 'cancel'],
  ['いいえ', 'no'],
  ['취소', 'cancel'],
  ['لا', 'no'],
  ['إلغاء', 'cancel'],
  ['नहीं', 'no'],
  ['batal', 'cancel'],
  ['ยกเลิก', 'cancel'],
  ['hủy', 'cancel'],
];

export function offlineEnglish(text: string): string | null {
  const low = text.toLowerCase();
  for (const [k, v] of OFFLINE_WORDS) if (low.includes(k.toLowerCase())) return v;
  return null;
}

const MEDIA_MARKERS = new Set([
  '[voice note]',
  '[voice]',
  '[audio]',
  '[image]',
  '[photo]',
  '[media]',
  '[document]',
  '[sticker]',
]);

/** Is this "reply" really a stand-in for media: blank, a bracketed marker, or a bare message id with no spaces. */
export function looksLikePlaceholder(text: string): boolean {
  const t = text.trim();
  if (t === '') return true;
  if (MEDIA_MARKERS.has(t.toLowerCase())) return true;
  return !t.includes(' ') && /^(wamid[.:]|3eb0|[A-F0-9]{20,})/i.test(t);
}

export const ORDER_PARSE_SYSTEM =
  "You convert a customer's WhatsApp message into a product order. " +
  'Respond with ONLY a single valid JSON object of the form ' +
  '{"items":[{"name":"<product as the customer wrote it, any language>","qty":<number>}]}. ' +
  'Default qty to 1 when unspecified. If there is no order, return {"items":[]}. ' +
  'No markdown, no commentary, JSON only.';

export const SHIPPING_SYSTEM =
  'A customer was shown their saved delivery address and asked to either CONFIRM it ' +
  '(by replying with ANY affirmative, in ANY language) or send a NEW delivery address. ' +
  'Read their reply and respond with ONLY a single JSON object: ' +
  '{"use_saved": true|false, "name":"<recipient name or empty>", "company":"<company or empty>", "address":"<full street/postal address, or empty>"}. ' +
  'Set use_saved=true ONLY when the reply is a pure confirmation/agreement with no new address. ' +
  "When they provided an address, set use_saved=false and fill the fields (keep the address in the customer's original language/script; if unsure put the whole reply in address). " +
  'No markdown, JSON only.';

/** The model's `{items:[{name,qty}]}` as `[{name, qty}]`: names trimmed and non-empty, quantity at least 1 (also `product`, `item`, `quantity`). */
export function normalizeItems(json: unknown): Array<{ name: string; qty: number }> {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: Array<{ name: string; qty: number }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const i = raw as Record<string, unknown>;
    const name = String(i.name ?? i.product ?? i.item ?? '').trim();
    if (name === '') continue;
    out.push({ name, qty: Math.max(1, Math.trunc(Number(i.qty ?? i.quantity ?? 1)) || 1) });
  }
  return out;
}

/** The ship-to as one block of lines. */
export const shippingText = (name: string, company: string, address: string): string =>
  [name, company, address]
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .join('\n');

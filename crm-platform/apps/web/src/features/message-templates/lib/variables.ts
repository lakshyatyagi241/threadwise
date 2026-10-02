import type { TplVariableMap } from '@crm/contracts';

/** `{{first_name}}`, `{{1}}`: word characters only, as the server reads them. */
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Distinct tokens in order of first appearance. */
export function tokensOf(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

/** Every occurrence counts, as Meta counts them. */
export const countPlaceholders = (text: string): number => [...text.matchAll(TOKEN)].length;

/** Rewrites each distinct token to its 1-based position of first appearance: `{{b}} {{a}} {{b}}` -> `{{1}} {{2}} {{1}}`. */
export function normalizePlaceholders(text: string): string {
  const tokens = tokensOf(text);
  return text.replace(TOKEN, (_m, t: string) => `{{${tokens.indexOf(t) + 1}}}`);
}

/** What the operator maps one token to: the contact attribute that fills it, and a sample value for Meta's review. */
export interface SlotInput {
  key: string;
  example: string;
}
export type SlotInputs = Record<string, SlotInput>;

/** Stand-in values for the preview when no sample was typed (Reference's list, display only). */
const STAND_INS: Record<string, string> = {
  name: 'John',
  first_name: 'John',
  last_name: 'Doe',
  full_name: 'John Doe',
  company: 'Acme Co',
  email: 'john@example.com',
  phone: '+1 555 0142',
  mobile: '+1 555 0142',
  city: 'Austin',
  country: 'USA',
  order_id: 'ORD-12',
  invoice: 'INV-77',
  amount: '$49.00',
  total: '$49.00',
  price: '$49.00',
  discount: '15%',
  coupon: 'SAVE15',
  promo: 'SAVE15',
  code: 'SAVE15',
  otp: '482913',
  date: 'May 25',
  time: '2:30 PM',
  tracking: 'TRK-93421',
  product: 'Hoodie',
  quantity: '2',
  url: 'example.com/x',
  link: 'example.com/x',
};

/** The text a token shows in the preview, or null when nothing is known (the pill then shows the token itself). */
export function sampleFor(token: string, slots: SlotInputs): string | null {
  const slot = slots[token];
  const typed = slot?.example.trim();
  if (typed) return typed;
  const key = (slot?.key || token).toLowerCase();
  return STAND_INS[key] ?? STAND_INS[token.toLowerCase()] ?? null;
}

/**
 * Keeps the entries of tokens still in the text, adds the new ones. A named token maps to itself; a numbered one starts
 * unmapped (its key is its number). Entries of removed tokens are dropped.
 */
export function syncSlots(text: string, prev: SlotInputs): SlotInputs {
  const next: SlotInputs = {};
  for (const t of tokensOf(text)) next[t] = prev[t] ?? { key: t, example: '' };
  return next;
}

/** The `variableMap` the API stores: one slot per distinct token, numbered like the normalised text. */
export function toVariableMap(
  header: { text: string; slots: SlotInputs } | null,
  body: { text: string; slots: SlotInputs },
): TplVariableMap {
  const build = (text: string, slots: SlotInputs) =>
    tokensOf(text).map((t, i) => {
      const slot = slots[t];
      const example = slot?.example.trim();
      return { num: i + 1, key: (slot?.key.trim() || t).slice(0, 100), ...(example ? { example: example.slice(0, 200) } : {}) };
    });
  const map: TplVariableMap = {};
  if (header && tokensOf(header.text).length) map.header = build(header.text, header.slots);
  if (tokensOf(body.text).length) map.body = build(body.text, body.slots);
  return map;
}

/** Slot entries from a stored template: the key is the attribute, the example the sample, by position. */
export function slotsFromMap(
  text: string,
  slots: TplVariableMap['body'] | undefined,
): SlotInputs {
  const out: SlotInputs = {};
  tokensOf(text).forEach((t, i) => {
    const s = slots?.find((x) => x.num === i + 1);
    out[t] = { key: s?.key ?? t, example: s?.example ?? '' };
  });
  return out;
}

/** The text with each token replaced by its sample (or left as `{{token}}`). */
export function fillSamples(text: string, slots: SlotInputs): string {
  return text.replace(TOKEN, (m, t: string) => sampleFor(t, slots) ?? m);
}

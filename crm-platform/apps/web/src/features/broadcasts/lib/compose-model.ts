import type { ComposeTemplate } from '@crm/contracts';

/** The pure helpers the audience picker and the template preview still use (the old broadcast compose page moved into the Campaign wizard). */

export const toggle = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

// --- preview ---------------------------------------------------------------

/** Friendly stand-ins for the preview bubble, by lower-cased attribute key (Reference's list). */
const SAMPLES: Record<string, string> = {
  name: 'John',
  first_name: 'John',
  firstname: 'John',
  last_name: 'Doe',
  lastname: 'Doe',
  full_name: 'John Doe',
  fullname: 'John Doe',
  customer_name: 'John',
  company: 'Acme Co',
  company_name: 'Acme Co',
  business: 'Acme Co',
  email: 'john@example.com',
  phone: '+1 555 0142',
  mobile: '+1 555 0142',
  city: 'Austin',
  country: 'USA',
  order_id: 'ORD-12',
  order_number: 'ORD-12',
  order: 'ORD-12',
  invoice: 'INV-77',
  invoice_id: 'INV-77',
  amount: '$49.00',
  total: '$49.00',
  price: '$49.00',
  discount: '15%',
  coupon: 'SAVE15',
  promo: 'SAVE15',
  promo_code: 'SAVE15',
  code: 'SAVE15',
  otp: '482913',
  date: 'May 25',
  time: '2:30 PM',
  appointment: 'May 25, 2:30 PM',
  tracking: 'TRK-93421',
  tracking_id: 'TRK-93421',
  tracking_number: 'TRK-93421',
  product: 'Hoodie',
  product_name: 'Hoodie',
  quantity: '2',
  qty: '2',
  url: 'example.com/x',
  link: 'example.com/x',
};

const sampleFor = (key: string): string | null => SAMPLES[key.toLowerCase()] ?? null;

/** `{ slot: attribute key }` from a template's variable map, nested (`{header:[{num,key}], body:[...]}`) or flat (`{"1":"name"}`). */
export function slotMap(map: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return out;
  const m = map as Record<string, unknown>;
  const nested = ['header', 'body'].some((s) => m[s] !== undefined);
  if (!nested) {
    for (const [slot, key] of Object.entries(m))
      if (typeof key === 'string' && key) out[slot] = key;
    return out;
  }
  for (const section of ['header', 'body']) {
    const list = Array.isArray(m[section])
      ? (m[section] as unknown[])
      : Object.values((m[section] as object) ?? {});
    list.forEach((e, i) => {
      const obj = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : null;
      const key = String(obj ? (obj.key ?? '') : (e ?? ''));
      const num = obj && obj.num !== undefined ? Number(obj.num) : i + 1;
      if (key) out[String(num)] = key;
    });
  }
  return out;
}

/** Fills `{{name}}` and `{{1}}` with sample values; a token it cannot resolve stays as written. */
export function fillSamples(text: string, slots: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_][\w.-]*)\s*\}\}/g, (full, token: string) => {
    const key = /^\d+$/.test(token) ? slots[token] : token;
    return (key ? sampleFor(key) : null) ?? full;
  });
}

/** Everything the preview bubble shows for the picked template, samples filled. */
export function previewOf(t: ComposeTemplate) {
  const slots = slotMap(t.variableMap);
  const buttons = (Array.isArray(t.buttons) ? t.buttons : []).filter(
    (b): b is { type?: string; text: string } =>
      typeof b === 'object' && b !== null && Boolean((b as { text?: unknown }).text),
  );
  return {
    header: t.header ? fillSamples(t.header, slots) : '',
    body: t.body ? fillSamples(t.body, slots) : '(empty body)',
    footer: t.footer ?? '',
    category: t.category.charAt(0).toUpperCase() + t.category.slice(1),
    buttons,
    media:
      (t.attachmentType ?? '').toLowerCase() !== '' &&
      (t.attachmentType ?? '').toLowerCase() !== 'none'
        ? (t.attachmentType ?? '').toLowerCase()
        : null,
  };
}

/** Name or phone, case-insensitive: the audience table's search. */
export function matchesSearch(c: { name: string; phone: string }, q: string): boolean {
  const s = q.trim().toLowerCase();
  return s === '' || `${c.name} ${c.phone}`.toLowerCase().includes(s);
}

/** "Name", else "First Last", else "Contact #<short id>": the audience table's display name. */
export function contactName(c: {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const n = (c.name ?? '').trim();
  if (n) return n;
  const fl = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return fl || `Contact #${c.id.slice(0, 8)}`;
}

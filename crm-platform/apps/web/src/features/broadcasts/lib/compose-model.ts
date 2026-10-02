import type { ComposeTemplate, CreateBroadcastInput } from '@crm/contracts';

/** The pure half of the compose page (TW-BCAST-004 to 008): form state, share percentages, the request body, the preview text. */

export type ScheduleType = 'now' | 'later';

export interface ComposeForm {
  name: string;
  templateId: string;
  senderKeys: string[];
  /** Weight per sender key; a missing or non-positive weight is 1 on the server. */
  shares: Record<string, number>;
  tagIds: string[];
  groupIds: string[];
  contactIds: string[];
  scheduleType: ScheduleType;
  sendDate: string;
  sendTime: string;
  timezone: string;
  /** Send-time variable values; null when nothing was filled in. */
  overrides: Record<string, unknown> | null;
}

export const EMPTY_FORM: ComposeForm = {
  name: '',
  templateId: '',
  senderKeys: [],
  shares: {},
  tagIds: [],
  groupIds: [],
  contactIds: [],
  scheduleType: 'now',
  sendDate: '',
  sendTime: '',
  timezone: 'UTC',
  overrides: null,
};

export const toggle = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/**
 * The live "share" percentage beside each ticked sender: its weight over the ticked weights, rounded. A sender that is not
 * ticked has none (null), a ticked one with a zero or bad weight shows 0%.
 */
export function sharePercents(
  keys: readonly string[],
  checked: readonly string[],
  shares: Record<string, number>,
): Record<string, number | null> {
  const weight = (k: string) => {
    const w = shares[k] ?? 1;
    return Number.isFinite(w) && w > 0 ? w : 0;
  };
  const total = checked.reduce((a, k) => a + weight(k), 0);
  const out: Record<string, number | null> = {};
  for (const k of keys) {
    if (!checked.includes(k)) out[k] = null;
    else out[k] = total > 0 && weight(k) > 0 ? Math.round((weight(k) / total) * 100) : 0;
  }
  return out;
}

/** Date and time the schedule opens with: today in the zone, and 30 minutes from now (Reference's defaults). */
export function defaultSchedule(
  now: Date,
  timezone: string,
): { sendDate: string; sendTime: string } {
  const at = new Date(now.getTime() + 30 * 60_000);
  const part = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', ...o }).format(d);
  const today = part(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = part(at, { hour: '2-digit', minute: '2-digit' });
  return { sendDate: today, sendTime: time };
}

/** What stops the form from being sent; empty means it can go. The audience is checked by the server (nobody sendable is refused there). */
export function problems(f: ComposeForm): Array<'name' | 'template' | 'schedule'> {
  const out: Array<'name' | 'template' | 'schedule'> = [];
  if (!f.name.trim()) out.push('name');
  if (!f.templateId) out.push('template');
  if (f.scheduleType === 'later' && (!f.sendDate || !f.sendTime)) out.push('schedule');
  return out;
}

/** The `POST /broadcasts` body: the schedule fields only for a later send, share weights only for the senders that are ticked. */
export function buildBody(f: ComposeForm): CreateBroadcastInput {
  const later = f.scheduleType === 'later';
  const share: Record<string, number> = {};
  for (const k of f.senderKeys) share[k] = f.shares[k] ?? 1;
  return {
    name: f.name.trim(),
    templateId: f.templateId,
    contactIds: f.contactIds,
    groupIds: f.groupIds,
    tagIds: f.tagIds,
    senderKeys: f.senderKeys,
    senderShare: share,
    scheduleType: f.scheduleType,
    ...(later ? { sendDate: f.sendDate, sendTime: f.sendTime } : {}),
    timezone: f.timezone,
    ...(f.overrides && Object.keys(f.overrides).length ? { templateOverrides: f.overrides } : {}),
  };
}

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

/** The picker's option text: the name, the WABA number it lives on, and the Twilio readiness mark. */
export function templateOptionLabel(t: ComposeTemplate, twilio: boolean): string {
  const parts = [t.name];
  if (t.senderLabel) parts.push(`· ${t.senderLabel}`);
  if (twilio) parts.push(t.twilioReady ? '✓ Twilio ready' : '· plain text only');
  return parts.join(' ');
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

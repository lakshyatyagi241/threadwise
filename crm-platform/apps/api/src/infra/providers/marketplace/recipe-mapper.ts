import { createHash } from 'node:crypto';
import type { MarketRecipe, RecipeFieldRule, RecipeSource } from '@crm/contracts';
import type { ConnectorFieldValue, ConnectorLead, ParsedDelivery } from './connector.port';

/**
 * Turns a delivery (or one item of a poll's answer) into leads, by the recipe's mapping. Pure: no clock, no network, no database, so
 * every recipe can be tested with a payload.
 *
 * Two modes. `explicit` follows the rules the recipe lists. `auto` is the generic webhook: well-known names (name, phone, email, ...)
 * are found by alias and every other scalar is carried over under its own (normalised) name, so a form tool's own field names survive.
 */

/** One delivery carries at most this many leads (an array answer). The rest are reported as rejected, never silently dropped. */
export const MAX_LEADS_PER_DELIVERY = 100;
const MAX_FIELDS = 60;
const MAX_VALUE_LENGTH = 2000;
const MAX_DEPTH = 3;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

type Json = unknown;

/** Reads `a.b[0].c`. Never walks into the prototype chain, never throws. */
export function readPath(root: Json, path: string): Json {
  let cur: Json = root;
  for (const m of path.matchAll(/([A-Za-z0-9_-]+)|\[(\d+)\]/g)) {
    const key = m[1] ?? m[2]!;
    if (FORBIDDEN_SEGMENTS.has(key)) return undefined;
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const i = Number(key);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (Object.prototype.hasOwnProperty.call(cur, key)) {
      cur = (cur as Record<string, Json>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

const isScalar = (v: Json): v is string | number | boolean =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

function scalarOf(v: Json): ConnectorFieldValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t.slice(0, MAX_VALUE_LENGTH);
  }
  return isScalar(v) ? v : undefined;
}

/** `Mobile Number` -> `mobile_number`. */
export const normaliseKey = (k: string): string =>
  k
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

// --- transforms ------------------------------------------------------------------------------------------------------------------------

function toPhone(raw: string, countryCode: string): string | undefined {
  const cleaned = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{6,20}$|^00\d{6,20}$/.test(cleaned)) return undefined;
  if (cleaned.startsWith('+')) return `+${cleaned.slice(1)}`;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  if (cleaned.length === 10) return `+${countryCode}${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('0')) return `+${countryCode}${cleaned.slice(1)}`;
  if (cleaned.startsWith(countryCode) && cleaned.length === countryCode.length + 10)
    return `+${cleaned}`;
  return cleaned.length >= 8 && cleaned.length <= 15 ? `+${cleaned}` : undefined;
}

export function applyTransforms(
  value: ConnectorFieldValue,
  transforms: readonly string[] | undefined,
  countryCode: string,
): ConnectorFieldValue | undefined {
  let v: ConnectorFieldValue | undefined = value;
  for (const t of transforms ?? []) {
    if (v === undefined || v === null) return undefined;
    const s: string = String(v);
    switch (t) {
      case 'trim':
        v = s.trim();
        break;
      case 'lower':
        v = s.toLowerCase();
        break;
      case 'upper':
        v = s.toUpperCase();
        break;
      case 'digits':
        v = s.replace(/\D+/g, '');
        break;
      case 'phone':
        v = toPhone(s, countryCode);
        break;
    }
    if (v === '') return undefined;
  }
  return v;
}

// --- ids ---------------------------------------------------------------------------------------------------------------------------------

/** A stable id for a delivery that carries none: a repeat of the same delivery hashes the same, so it is still recognised. */
export function payloadHashId(item: Json): string {
  return `h-${createHash('sha256').update(stableStringify(item)).digest('hex').slice(0, 32)}`;
}

function stableStringify(v: Json, depth = 0): string {
  if (v === null || typeof v !== 'object' || depth > 8) return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x, depth + 1)).join(',')}]`;
  const o = v as Record<string, Json>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k], depth + 1)}`)
    .join(',')}}`;
}

const isoOf = (v: Json): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

// --- explicit mode ------------------------------------------------------------------------------------------------------------------------

function sourceValue(item: Json, src: RecipeSource | undefined): string | undefined {
  if (!src) return undefined;
  const v = 'from' in src ? scalarOf(readPath(item, src.from)) : scalarOf(src.const);
  return v === undefined || v === null ? undefined : String(v).slice(0, 200);
}

function mapExplicit(
  item: Json,
  mapping: Extract<MarketRecipe['mapping'], { mode: 'explicit' }>,
): { lead: ConnectorLead } | { reason: string } {
  const fields: Record<string, ConnectorFieldValue> = {};
  for (const rule of mapping.fields as RecipeFieldRule[]) {
    const base =
      rule.from !== undefined ? scalarOf(readPath(item, rule.from)) : scalarOf(rule.const);
    let v =
      base === undefined
        ? undefined
        : applyTransforms(base, rule.transform, mapping.defaultCountryCode);
    if (v === undefined && rule.default !== undefined) v = rule.default;
    if (v === undefined || v === null) {
      if (rule.required) return { reason: `missing_${rule.to}` };
      continue;
    }
    fields[rule.to] = v;
  }
  const idRaw = mapping.externalId ? scalarOf(readPath(item, mapping.externalId.from)) : undefined;
  const lead: ConnectorLead = {
    externalId:
      idRaw === undefined || idRaw === null ? payloadHashId(item) : String(idRaw).slice(0, 200),
    fields,
    raw: item,
  };
  const at = mapping.receivedAt ? isoOf(readPath(item, mapping.receivedAt.from)) : undefined;
  if (at) lead.receivedAt = at;
  const a = mapping.attribution;
  if (a) {
    const attribution: NonNullable<ConnectorLead['attribution']> = {};
    for (const k of ['platform', 'campaign', 'adset', 'ad', 'form'] as const) {
      const v = sourceValue(item, a[k]);
      if (v !== undefined) attribution[k] = v;
    }
    if (Object.keys(attribution).length > 0) lead.attribution = attribution;
  }
  return { lead };
}

// --- auto mode ------------------------------------------------------------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  name: [
    'name',
    'full_name',
    'fullname',
    'customer_name',
    'lead_name',
    'contact_name',
    'sender_name',
  ],
  phone: [
    'phone',
    'mobile',
    'mobile_number',
    'phone_number',
    'contact_number',
    'whatsapp',
    'whatsapp_number',
    'contact',
    'sender_mobile',
  ],
  email: ['email', 'email_id', 'email_address', 'mail', 'sender_email'],
  message: [
    'message',
    'requirement',
    'comments',
    'comment',
    'note',
    'notes',
    'enquiry',
    'inquiry',
    'query_message',
    'query',
  ],
  company: ['company', 'company_name', 'organization', 'organisation', 'sender_company'],
  city: ['city', 'location', 'sender_city'],
};
const ID_KEYS = [
  'id',
  'lead_id',
  'leadid',
  'external_id',
  'externalid',
  'uuid',
  'query_id',
  'enquiry_id',
  'inquiry_id',
  'reference',
  'ref',
  'unique_query_id',
];
const TIME_KEYS = [
  'created_at',
  'createdat',
  'received_at',
  'timestamp',
  'time',
  'date',
  'created_time',
  'query_time',
];
const ATTRIBUTION_KEYS = {
  platform: ['utm_source', 'platform', 'source'],
  campaign: ['utm_campaign', 'campaign', 'campaign_name'],
  adset: ['adset', 'adset_name', 'ad_set', 'utm_term'],
  ad: ['ad', 'ad_name', 'utm_content'],
  form: ['form', 'form_id', 'form_name'],
} as const;

/** Flattens nested objects (`contact.phone` becomes `contact_phone`) and keeps scalars only. */
function flatten(
  v: Json,
  prefix: string,
  out: Map<string, ConnectorFieldValue>,
  depth: number,
): void {
  if (out.size >= MAX_FIELDS) return;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    if (depth >= MAX_DEPTH) return;
    for (const [k, child] of Object.entries(v as Record<string, Json>)) {
      if (FORBIDDEN_SEGMENTS.has(k)) continue;
      const key = normaliseKey(prefix ? `${prefix}_${k}` : k);
      if (key) flatten(child, key, out, depth + 1);
    }
    return;
  }
  const s = scalarOf(v);
  if (s !== undefined && s !== null && prefix && !out.has(prefix)) out.set(prefix, s);
}

function mapAuto(item: Json): { lead: ConnectorLead } | { reason: string } {
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    return { reason: 'not_an_object' };
  const flat = new Map<string, ConnectorFieldValue>();
  flatten(item, '', flat, 0);
  if (flat.size === 0) return { reason: 'empty' };

  const take = (names: readonly string[]): ConnectorFieldValue | undefined => {
    for (const n of names) {
      const v = flat.get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const fields: Record<string, ConnectorFieldValue> = {};
  const used = new Set<string>();
  for (const [canonical, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => flat.has(n));
    if (hit) {
      fields[canonical] = flat.get(hit)!;
      used.add(hit);
    }
  }
  if (fields.name === undefined) {
    const first = take(['first_name', 'firstname', 'fname']);
    const last = take(['last_name', 'lastname', 'lname', 'surname']);
    const joined = [first, last]
      .filter((x) => x !== undefined && x !== null)
      .join(' ')
      .trim();
    if (joined) {
      fields.name = joined;
      used
        .add('first_name')
        .add('firstname')
        .add('fname')
        .add('last_name')
        .add('lastname')
        .add('lname')
        .add('surname');
    }
  }
  if (typeof fields.phone === 'string') {
    const p = toPhone(fields.phone, '91');
    if (p) fields.phone = p;
  }
  if (typeof fields.email === 'string') fields.email = fields.email.toLowerCase();

  const idRaw = take(ID_KEYS);
  const idKey = ID_KEYS.find((k) => flat.has(k));
  if (idKey) used.add(idKey);
  const attribution: NonNullable<ConnectorLead['attribution']> = {};
  for (const [slot, names] of Object.entries(ATTRIBUTION_KEYS) as Array<
    [keyof typeof ATTRIBUTION_KEYS, readonly string[]]
  >) {
    const v = take(names);
    if (v !== undefined && v !== null) attribution[slot] = String(v).slice(0, 200);
  }
  for (const [k, v] of flat) {
    if (used.has(k) || k in fields) continue;
    if (Object.keys(fields).length >= MAX_FIELDS) break;
    fields[k] = v;
  }

  const lead: ConnectorLead = {
    externalId:
      idRaw === undefined || idRaw === null ? payloadHashId(item) : String(idRaw).slice(0, 200),
    fields,
    raw: item,
  };
  const timeKey = TIME_KEYS.find((k) => flat.has(k));
  const at = timeKey ? isoOf(flat.get(timeKey)) : undefined;
  if (at) lead.receivedAt = at;
  if (Object.keys(attribution).length > 0) lead.attribution = attribution;
  return { lead };
}

// --- entry point ----------------------------------------------------------------------------------------------------------------------------

/** The leads in one delivery or poll answer, and the items that could not be mapped with the reason for each. */
export function mapDelivery(recipe: MarketRecipe, body: Json): ParsedDelivery {
  const mapping = recipe.mapping;
  let items: Json[];
  if (mapping.mode === 'explicit' && mapping.itemsPath) {
    const at = readPath(body, mapping.itemsPath);
    items = Array.isArray(at) ? at : at === undefined ? [] : [at];
  } else {
    items = Array.isArray(body) ? body : [body];
  }
  const leads: ConnectorLead[] = [];
  const rejected: ParsedDelivery['rejected'] = [];
  items.forEach((item, index) => {
    if (index >= MAX_LEADS_PER_DELIVERY) {
      rejected.push({ index, reason: 'too_many_items' });
      return;
    }
    const r = mapping.mode === 'explicit' ? mapExplicit(item, mapping) : mapAuto(item);
    if ('lead' in r) leads.push(r.lead);
    else rejected.push({ index, reason: r.reason });
  });
  return { leads, rejected };
}

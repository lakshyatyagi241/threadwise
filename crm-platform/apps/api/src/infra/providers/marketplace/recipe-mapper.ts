import { createHash } from 'node:crypto';
import type {
  MarketRecipe,
  RecipeDerivedId,
  RecipeFieldRule,
  RecipeSource,
  RecipeTime,
} from '@crm/contracts';
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
      case 'unescape':
        v = unescapeText(s);
        break;
    }
    if (v === '') return undefined;
  }
  return v;
}

/**
 * Some portals double-escape a buyer's message: the two characters backslash and `n` arrive where a line break was. Turns the common
 * sequences back into the character; anything else with a backslash is left alone.
 */
export function unescapeText(s: string): string {
  return s.replace(/\\([ntrb\\])/g, (_m, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === 'b' ? '' : '\\',
  );
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

/** A time the portal wrote, as an ISO instant. A time with no zone is the portal's own: `utcOffsetMinutes` east of UTC. */
export function parseTime(
  v: Json,
  format: RecipeTime['format'],
  utcOffsetMinutes: number,
): string | undefined {
  if (format === 'epoch_seconds' || format === 'epoch_millis') {
    const n =
      typeof v === 'number'
        ? v
        : typeof v === 'string' && /^\d{9,13}$/.test(v.trim())
          ? Number(v.trim())
          : Number.NaN;
    if (!Number.isFinite(n)) return undefined;
    const d = new Date(format === 'epoch_seconds' ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v !== 'string') return undefined;
  const text = v.trim();
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(text);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    const ms =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) -
      utcOffsetMinutes * 60_000;
    const at = new Date(ms);
    return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
  }
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** `d-` and 32 hex characters of the SHA-256 of the parts: the same lead, however the portal formats it, is the same id. */
function derivedId(derive: RecipeDerivedId, parts: Array<string | undefined>): string | null {
  if (parts.some((p) => p === undefined || p === '')) return null;
  return `${derive.prefix}-${createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32)}`;
}

// --- explicit mode ------------------------------------------------------------------------------------------------------------------------

const mapped = (v: string, map: Record<string, string> | undefined): string => map?.[v] ?? v;

function sourceValue(item: Json, src: RecipeSource | undefined): string | undefined {
  if (!src) return undefined;
  const v = 'from' in src ? scalarOf(readPath(item, src.from)) : scalarOf(src.const);
  if (v === undefined || v === null) return undefined;
  const text = String(v);
  return ('from' in src ? mapped(text, src.map) : text).slice(0, 200);
}

/** The first of a rule's paths that yields a usable value, after the rule's ignore list and transforms. */
function ruleValue(
  item: Json,
  rule: RecipeFieldRule,
  countryCode: string,
): ConnectorFieldValue | undefined {
  const ignored = new Set((rule.ignore ?? []).map((x) => x.trim().toLowerCase()));
  const paths = rule.from !== undefined ? [rule.from, ...(rule.fallbackFrom ?? [])] : [];
  const candidates: Array<ConnectorFieldValue | undefined> =
    rule.from !== undefined
      ? paths.map((p) => scalarOf(readPath(item, p)))
      : [scalarOf(rule.const)];
  for (const base of candidates) {
    if (base === undefined || base === null) continue;
    if (typeof base === 'string' && ignored.has(base.trim().toLowerCase())) continue;
    const v = applyTransforms(base, rule.transform, countryCode);
    if (v === undefined || v === null) continue;
    return typeof v === 'string' && rule.map ? mapped(v, rule.map) : v;
  }
  return undefined;
}

function mapExplicit(
  item: Json,
  mapping: Extract<MarketRecipe['mapping'], { mode: 'explicit' }>,
): { lead: ConnectorLead } | { reason: string } {
  const fields: Record<string, ConnectorFieldValue> = {};
  for (const rule of mapping.fields as RecipeFieldRule[]) {
    let v = ruleValue(item, rule, mapping.defaultCountryCode);
    if (v === undefined && rule.default !== undefined) v = rule.default ?? undefined;
    if (v === undefined || v === null) {
      if (rule.required) return { reason: `missing_${rule.to}` };
      continue;
    }
    fields[rule.to] = v;
  }
  let externalId: string | null = null;
  if (mapping.externalId) {
    const idRaw = scalarOf(readPath(item, mapping.externalId.from));
    if (idRaw !== undefined && idRaw !== null) externalId = String(idRaw).slice(0, 200);
  } else if (mapping.externalIdDerive) {
    externalId = derivedId(
      mapping.externalIdDerive,
      mapping.externalIdDerive.parts.map((p) => {
        const raw = scalarOf(readPath(item, p.from));
        if (raw === undefined || raw === null) return undefined;
        const v = applyTransforms(raw, p.transform, mapping.defaultCountryCode);
        return v === undefined || v === null ? undefined : String(v);
      }),
    );
  }
  const lead: ConnectorLead = {
    externalId: externalId ?? payloadHashId(item),
    fields,
    raw: item,
  };
  const at = mapping.receivedAt
    ? parseTime(
        readPath(item, mapping.receivedAt.from),
        mapping.receivedAt.format,
        mapping.receivedAt.utcOffsetMinutes,
      )
    : undefined;
  if (at) lead.receivedAt = at;
  else if (mapping.receivedAtApproximate) fields.received_at_approximate = true;
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
    'lead_phone',
    'mobile_no',
    'phone_no',
    'contact_no',
  ],
  email: ['email', 'email_id', 'email_address', 'mail', 'sender_email', 'lead_email'],
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
    // What the real-estate and trade portals call it (proposed payloads: remark at MagicBricks, QryInfo at 99acres, msg in a pull sheet).
    'remark',
    'remarks',
    'msg',
    'qryinfo',
    'description',
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
  'queryid',
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
const COUNTRY_CODE_KEYS = ['country_code', 'countrycode', 'isd_code', 'dial_code'] as const;

/** `+` and the country code in front of a national number, unless the number already carries one. Null when it is not a number. */
function withCountryCode(raw: string, countryCode: string): string | null {
  if (!countryCode) return null;
  const bare = raw.replace(/[\s().-]/g, '');
  if (bare.startsWith('+') || bare.startsWith('00')) return null;
  const national = bare.replace(/^0+/, '');
  if (!/^\d{6,15}$/.test(national)) return null;
  const complete = national.startsWith(countryCode) && national.length >= countryCode.length + 10;
  return `+${complete ? national : countryCode + national}`;
}

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

type AutoMapping = Extract<MarketRecipe['mapping'], { mode: 'auto' }>;
const DEFAULT_AUTO: AutoMapping = {
  mode: 'auto',
  defaultCountryCode: '91',
  receivedAtApproximate: false,
  utcOffsetMinutes: 0,
};

function mapAuto(
  item: Json,
  mapping: AutoMapping = DEFAULT_AUTO,
): { lead: ConnectorLead } | { reason: string } {
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
  if (typeof fields.phone === 'number') fields.phone = String(fields.phone);
  // A portal that sends the country code apart from the number (`country_code: 91`, `phone: 9876543210`).
  const ccKey = COUNTRY_CODE_KEYS.find((k) => flat.has(k));
  const cc = ccKey ? String(flat.get(ccKey)).replace(/\D/g, '') : '';
  if (ccKey && cc) used.add(ccKey);
  if (typeof fields.phone === 'string') {
    const p =
      withCountryCode(fields.phone, cc) ?? toPhone(fields.phone, mapping.defaultCountryCode);
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

  let externalId: string | null =
    idRaw === undefined || idRaw === null ? null : String(idRaw).slice(0, 200);
  if (externalId === null && mapping.externalIdDerive) {
    // The raw payload's own path first, then the flattened name (`Mobile` is found as `mobile`): a payload nobody has seen yet.
    externalId = derivedId(
      mapping.externalIdDerive,
      mapping.externalIdDerive.parts.map((p) => {
        const raw = scalarOf(readPath(item, p.from)) ?? flat.get(normaliseKey(p.from));
        if (raw === undefined || raw === null) return undefined;
        const v = applyTransforms(raw, p.transform, mapping.defaultCountryCode);
        return v === undefined || v === null ? undefined : String(v);
      }),
    );
  }
  const lead: ConnectorLead = {
    externalId: externalId ?? payloadHashId(item),
    fields,
    raw: item,
  };
  const timeKey = TIME_KEYS.find((k) => flat.has(k));
  const at = timeKey ? parseTime(flat.get(timeKey), 'iso', mapping.utcOffsetMinutes) : undefined;
  if (at) lead.receivedAt = at;
  else if (mapping.receivedAtApproximate) fields.received_at_approximate = true;
  if (attribution.platform === undefined && mapping.platform)
    attribution.platform = mapping.platform;
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
  return mapItems(recipe, items);
}

/** The items of an answer already taken out of its wrapper, mapped one by one (a pull connector finds its own list). */
export function mapItems(recipe: MarketRecipe, items: Json[]): ParsedDelivery {
  const mapping = recipe.mapping;
  const leads: ConnectorLead[] = [];
  const rejected: ParsedDelivery['rejected'] = [];
  items.forEach((item, index) => {
    if (index >= MAX_LEADS_PER_DELIVERY) {
      rejected.push({ index, reason: 'too_many_items' });
      return;
    }
    const r = mapping.mode === 'explicit' ? mapExplicit(item, mapping) : mapAuto(item, mapping);
    if ('lead' in r) leads.push(r.lead);
    else rejected.push({ index, reason: r.reason });
  });
  return { leads, rejected };
}

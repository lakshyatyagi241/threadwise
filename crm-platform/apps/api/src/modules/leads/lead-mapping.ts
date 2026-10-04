import { createHash } from 'node:crypto';
import type { LeadFieldMapping } from '@crm/contracts';

/**
 * Turning a payload into the facts the pipeline needs: pure functions, no database, so every rule is unit-tested without one.
 *
 * Reference behaviour (Reference's incoming webhook, `IncomingWebhookController::captureLead`): the admin names a payload path for phone,
 * name and email; without one the first of a list of common names is used (`phone`, `mobile`, `phone_number`, ...); a first name with a
 * separate `last_name` is joined. This keeps all of that and adds: custom properties, attribution, a case- and punctuation-insensitive
 * match (`Phone Number` finds `phone_number`), and nested payloads (`contact.phone` is found by its last segment).
 */

export type FlatValue = string | number | boolean | null;
export type FlatFields = Record<string, FlatValue>;

const MAX_FLAT_KEYS = 300;
const MAX_VALUE_LENGTH = 2000;
const MAX_DEPTH = 6;

/**
 * Every scalar of a JSON-like body by its path: `a.b` for an object member, `a[0]` for an array item. A form body is already flat. Bounded
 * (keys, depth, value length) because the body is the public's: the numbers are generous for a lead form and hostile to a bomb.
 */
export function flattenPayload(body: unknown): FlatFields {
  const out: FlatFields = {};
  const walk = (value: unknown, path: string, depth: number): void => {
    if (Object.keys(out).length >= MAX_FLAT_KEYS) return;
    if (value === null) {
      if (path) out[path] = null;
      return;
    }
    if (typeof value === 'string') {
      if (path)
        out[path] = value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value;
      return;
    }
    if (typeof value === 'number') {
      if (path && Number.isFinite(value)) out[path] = value;
      return;
    }
    if (typeof value === 'boolean') {
      if (path) out[path] = value;
      return;
    }
    if (depth >= MAX_DEPTH) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof value === 'object' && value !== undefined) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  walk(body, '', 0);
  return out;
}

/** `Phone Number`, `phone_number` and `phoneNumber` are the same key. */
export const canonicalKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const textOf = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

/** The value at a dotted/indexed path of an untyped payload (the fallback when only `raw` is held). */
export function getPath(root: unknown, path: string): unknown {
  const parts = path.split(/\.|\[(\d+)\]/).filter((p): p is string => p !== undefined && p !== '');
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export interface LeadSubject {
  fields: FlatFields;
  raw?: unknown;
}

/**
 * The text a path points at: the exact key of `fields`, else the same key written another way, else a walk into `raw`. Empty and
 * non-scalar values are "not there".
 */
export function lookupPath(lead: LeadSubject, path: string | undefined | null): string | null {
  if (!path) return null;
  const direct = textOf(lead.fields[path]);
  if (direct !== null) return direct;
  const want = canonicalKey(path);
  if (want !== '') {
    for (const [key, value] of Object.entries(lead.fields)) {
      if (canonicalKey(key) === want) {
        const t = textOf(value);
        if (t !== null) return t;
      }
    }
  }
  return lead.raw === undefined ? null : textOf(getPath(lead.raw, path));
}

/** The common names a field goes by, in the order they are tried (canonical form). Reference's lists plus what lead forms send. */
export const FIELD_ALIASES = {
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'whatsapp',
    'whatsappnumber',
    'wanumber',
    'number',
    'contactnumber',
    'msisdn',
    'telephone',
    'tel',
    'cell',
    'contactphone',
  ],
  email: ['email', 'emailaddress', 'mail', 'contactemail', 'workemail'],
  name: ['fullname', 'name', 'contactname', 'customername', 'leadname'],
  firstName: ['firstname', 'fname', 'givenname'],
  lastName: ['lastname', 'lname', 'surname', 'familyname'],
  platform: ['platform', 'utmsource'],
  campaign: ['campaign', 'campaignname', 'utmcampaign'],
  adset: ['adset', 'adsetname', 'adgroup', 'adgroupname'],
  ad: ['ad', 'adname', 'creative', 'utmcontent'],
  form: ['form', 'formname', 'leadform', 'formid'],
} as const;
type AliasName = keyof typeof FIELD_ALIASES;

const lastSegment = (key: string): string =>
  key
    .split(/\.|\[\d+\]/)
    .filter(Boolean)
    .pop() ?? key;

/**
 * The first alias the payload carries: a top-level key beats a nested one (`phone` before `contact.phone`), aliases earlier in the list
 * beat later ones, and between two nested keys the shorter path wins, then the alphabetical one, so the answer never depends on key order.
 */
export function autoDetect(lead: LeadSubject, name: AliasName): string | null {
  const aliases: readonly string[] = FIELD_ALIASES[name];
  const entries = Object.entries(lead.fields);
  for (const alias of aliases) {
    for (const [key, value] of entries) {
      if (key.includes('.') || key.includes('[')) continue;
      if (canonicalKey(key) === alias) {
        const t = textOf(value);
        if (t !== null) return t;
      }
    }
  }
  const nested = entries
    .filter(([key]) => key.includes('.') || key.includes('['))
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  for (const alias of aliases) {
    for (const [key, value] of nested) {
      if (canonicalKey(lastSegment(key)) === alias) {
        const t = textOf(value);
        if (t !== null) return t;
      }
    }
  }
  return null;
}

export interface ResolvedLeadFields {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** As written; the caller normalises it with the source's default country code. */
  phoneRaw: string | null;
  /** Contact property key -> the text the payload holds for it (typed by `coerceCustomValue`). */
  custom: Record<string, string>;
  attribution: {
    platform: string | null;
    campaign: string | null;
    adset: string | null;
    ad: string | null;
    form: string | null;
  };
  /** Problems found while reading, for the preview and the event ("email is not an address"). */
  notes: string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normaliseLeadEmail = (raw: string | null): string | null => {
  const t = raw?.trim().toLowerCase();
  return t && t.length <= 254 && EMAIL_PATTERN.test(t) ? t : null;
};

const clip = (v: string | null, max: number): string | null =>
  v === null ? null : v.length > max ? v.slice(0, max) : v;

/** Applies a source's mapping to a lead: a mapped path wins, else the lead's own attribution, else the common names. */
export function resolveLeadFields(
  lead: LeadSubject & { attribution?: Partial<Record<string, string | undefined>> },
  mapping: LeadFieldMapping,
): ResolvedLeadFields {
  const notes: string[] = [];
  const pick = (mapped: string | undefined, alias: AliasName): string | null =>
    lookupPath(lead, mapped) ?? autoDetect(lead, alias);

  const firstName = clip(pick(mapping.firstName, 'firstName'), 191);
  const lastName = clip(pick(mapping.lastName, 'lastName'), 191);
  let name = clip(pick(mapping.name, 'name'), 191);
  if (name === null) {
    name = clip([firstName, lastName].filter(Boolean).join(' ') || null, 191);
  } else if (firstName !== null && lastName !== null && !mapping.name) {
    // A single "name" that is just the first name, with the last name sent apart: join them (Reference did).
    if (name === firstName && !name.toLowerCase().includes(lastName.toLowerCase())) {
      name = clip(`${name} ${lastName}`, 191);
    }
  }

  const emailText = pick(mapping.email, 'email');
  const email = normaliseLeadEmail(emailText);
  if (emailText !== null && email === null) notes.push('email_invalid');

  const custom: Record<string, string> = {};
  for (const [key, path] of Object.entries(mapping.customFields ?? {})) {
    const v = lookupPath(lead, path);
    if (v !== null) custom[key] = v;
  }

  const attr = mapping.attribution ?? {};
  const own = lead.attribution ?? {};
  const attribution = {
    platform: clip(
      lookupPath(lead, attr.platform) ?? textOf(own.platform) ?? autoDetect(lead, 'platform'),
      60,
    ),
    campaign: clip(
      lookupPath(lead, attr.campaign) ?? textOf(own.campaign) ?? autoDetect(lead, 'campaign'),
      255,
    ),
    adset: clip(
      lookupPath(lead, attr.adset) ?? textOf(own.adset) ?? autoDetect(lead, 'adset'),
      255,
    ),
    ad: clip(lookupPath(lead, attr.ad) ?? textOf(own.ad) ?? autoDetect(lead, 'ad'), 255),
    form: clip(lookupPath(lead, attr.form) ?? textOf(own.form) ?? autoDetect(lead, 'form'), 255),
  };

  return {
    name,
    firstName,
    lastName,
    email,
    phoneRaw: pick(mapping.phone, 'phone'),
    custom,
    attribution,
    notes,
  };
}

/** A contact property value in the type its field holds. `undefined` means "cannot be stored as this type": the value is skipped. */
export function coerceCustomValue(fieldType: string, raw: string): unknown {
  const text = raw.trim();
  if (text === '') return undefined;
  switch (fieldType) {
    case 'integer':
    case 'big_integer': {
      const n = Number(text.replace(/[, ]/g, ''));
      return Number.isInteger(n) ? n : undefined;
    }
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating': {
      const n = Number(text.replace(/[, ]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
    case 'checkbox': {
      const v = text.toLowerCase();
      if (['true', 'yes', 'y', '1', 'on'].includes(v)) return true;
      if (['false', 'no', 'n', '0', 'off'].includes(v)) return false;
      return undefined;
    }
    case 'multiselect':
      return text
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
    default:
      return text.length > MAX_VALUE_LENGTH ? text.slice(0, MAX_VALUE_LENGTH) : text;
  }
}

/** The property types a lead can write into. A formula or a lookup is computed or points at another record: never mapped. */
export const MAPPABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text',
  'long_text',
  'integer',
  'big_integer',
  'decimal',
  'percentage',
  'currency',
  'boolean',
  'checkbox',
  'radio',
  'date',
  'datetime',
  'url',
  'email',
  'phone',
  'select',
  'multiselect',
  'rating',
  'timezone',
]);

/** JSON with sorted keys: the same body in any key order is the same string (and so the same hash). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * The idempotency key of a delivery: the sender's own id when the source says where it is (`externalIdPath`) and the payload has one,
 * else a hash of the body. A hash makes the same body twice a duplicate (a retried POST), which is what a sender that has no id needs;
 * two people who happen to send identical bodies do not exist, a body carries at least a name or a number.
 */
export function deriveExternalId(
  lead: LeadSubject,
  body: unknown,
  externalIdPath: string | null | undefined,
): { externalId: string; derived: boolean } {
  const own = lookupPath(lead, externalIdPath);
  if (own !== null) {
    return own.length <= 255
      ? { externalId: own, derived: false }
      : {
          externalId: `h:${createHash('sha256').update(own).digest('hex').slice(0, 40)}`,
          derived: false,
        };
  }
  const hash = createHash('sha256').update(canonicalJson(body)).digest('hex').slice(0, 40);
  return { externalId: `h:${hash}`, derived: true };
}

const MAX_RAW_JSON_LENGTH = 512 * 1024;

/**
 * Removes the NUL character (`\u0000`) from every string and key of a value. Postgres refuses it in `text` and `jsonb`, so a body that
 * carries one would otherwise fail the insert with a 500 instead of being stored: whatever the public sends must be storable.
 */
export function stripNul<T>(value: T, depth = 0): T {
  if (typeof value === 'string')
    return (value.includes('\u0000') ? value.replaceAll('\u0000', '') : value) as T;
  if (value === null || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => stripNul(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k.includes('\u0000') ? k.replaceAll('\u0000', '') : k] = stripNul(v, depth + 1);
  }
  return out as T;
}

/**
 * A lead as the pipeline stores it: NUL removed, and a raw payload over 512 KB dropped (the flattened `fields` are already bounded and are
 * what mapping reads). A connector may hand over a provider response of any size; the table is not where a large blob belongs.
 */
export function boundLead<
  T extends { externalId: string; fields: unknown; raw?: unknown; attribution?: unknown },
>(lead: T): T {
  const clean = stripNul(lead);
  if (clean.raw !== undefined && JSON.stringify(clean.raw).length > MAX_RAW_JSON_LENGTH) {
    return { ...clean, raw: undefined };
  }
  return clean;
}

/** Fills `{{name}}`, `{{source}}` and `{{campaign}}` in a deal title; an empty result falls back to `fallback`. */
export function renderDealTitle(
  template: string,
  vars: { name: string | null; source: string | null; campaign: string | null },
  fallback: string,
): string {
  const filled = template
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name ?? '')
    .replace(/\{\{\s*source\s*\}\}/gi, vars.source ?? '')
    .replace(/\{\{\s*campaign\s*\}\}/gi, vars.campaign ?? '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = filled === '' ? fallback : filled;
  return title.length > 191 ? title.slice(0, 191) : title;
}

import { createHash } from 'node:crypto';
import { TRIGGER_HOPS_VAR } from './trigger-hops';

/** What a body or a sheet row may hold: more keys or longer text than this is cut, never refused, so a big sender still starts the flow. */
export const EXTERNAL_VARS_MAX = 100;
export const EXTERNAL_VALUE_MAX = 1000;
const NESTING_MAX = 3;

/** A run variable's name from a key as the sender wrote it (`Order No.` becomes `order_no`); empty when nothing usable is left. */
export function variableName(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

const scalar = (v: unknown): string | null => {
  if (typeof v === 'string') return v.slice(0, EXTERNAL_VALUE_MAX);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

/**
 * The run variables of a JSON object: each scalar becomes text under its own name; a nested object is flattened with `_` (`{"a":{"b":1}}`
 * gives `a_b`); an array is kept as its JSON text. Never a name the engine keeps for itself, never a prototype key.
 */
export function payloadVariables(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, value: string): void => {
    if (name === '' || name === TRIGGER_HOPS_VAR || name.startsWith('__')) return;
    if (name in out || Object.keys(out).length >= EXTERNAL_VARS_MAX) return;
    out[name] = value;
  };
  const walk = (prefix: string, value: unknown, depth: number): void => {
    const text = scalar(value);
    if (text !== null) return put(prefix, text);
    if (Array.isArray(value))
      return put(prefix, JSON.stringify(value).slice(0, EXTERNAL_VALUE_MAX));
    if (value !== null && typeof value === 'object' && depth < NESTING_MAX) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const part = variableName(k);
        if (part !== '') walk(prefix === '' ? part : `${prefix}_${part}`, v, depth + 1);
      }
    }
  };
  walk('', body, 0);
  return out;
}

/** The names a sender's phone, email and name go by, in the order they are tried. */
const PHONE_KEYS = [
  'phone',
  'mobile',
  'whatsapp',
  'phone_number',
  'mobile_number',
  'contact_phone',
];
const EMAIL_KEYS = ['email', 'email_address', 'contact_email'];
const NAME_KEYS = ['name', 'full_name', 'contact_name', 'first_name'];

export interface ExternalPerson {
  phone: string | null;
  email: string | null;
  name: string | null;
}

const first = (vars: Record<string, string>, keys: readonly string[]): string | null => {
  for (const k of keys) {
    const v = vars[k]?.trim();
    if (v) return v;
  }
  return null;
};

/** Who a payload is about, read from the flattened variables. */
export function personOf(vars: Record<string, string>): ExternalPerson {
  return {
    phone: first(vars, PHONE_KEYS),
    email: first(vars, EMAIL_KEYS),
    name: first(vars, NAME_KEYS),
  };
}

/**
 * Names one delivery: the sender's own id when it sent one (a header value, short and plain), else a hash of the exact body, so a
 * retry of the same post is the same delivery and two different posts never are.
 */
export function deliveryKey(header: string | undefined, raw: Buffer): string {
  const given = header?.trim();
  if (given && /^[\w.:-]{1,128}$/.test(given)) return `id:${given}`;
  return `sha:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

/** The run variables of one sheet row: each header's cell, by the header's variable name; the row's number is `row_number`. */
export function rowVariables(
  headers: readonly string[],
  cells: readonly string[],
  rowNumber: number,
): Record<string, string> {
  const out: Record<string, string> = { row_number: String(rowNumber) };
  headers.forEach((h, i) => {
    const name = variableName(String(h));
    const value = String(cells[i] ?? '').slice(0, EXTERNAL_VALUE_MAX);
    if (name === '' || name.startsWith('__') || name in out || value === '') return;
    if (Object.keys(out).length < EXTERNAL_VARS_MAX) out[name] = value;
  });
  return out;
}

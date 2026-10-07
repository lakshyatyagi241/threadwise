import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/** An active, editable custom contact property, as the bulk update needs it. */
export interface PropertyDef {
  key: string;
  label: string;
  fieldType: string;
  /** The values of the options a person may still pick (hidden options are left out). */
  options: readonly string[];
}

/** What a bulk update does to the properties: keys to set (already in their stored type) and keys to remove. */
export interface PropertyPlan {
  set: Record<string, unknown>;
  clear: string[];
}

/** Same ceilings the contact form puts on its inputs (`maxLength` 1000 for one-line text, 4000 for long text). */
const TEXT_MAX = 1000;
const LONG_TEXT_MAX = 4000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

type Coerced = { ok: true; value: unknown } | { ok: false; message: string };
const bad = (message: string): Coerced => ({ ok: false, message });
const good = (value: unknown): Coerced => ({ ok: true, value });

/** A value that clears the property: nothing, blank text, an empty list. */
export function isClearValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * One value, held to the property's type and returned in the form the contact form stores it in (text for text, a number for
 * a number, a boolean for a checkbox, `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` for dates, a list for a multi-select).
 * The value is not a clear (see `isClearValue`).
 */
export function coercePropertyValue(def: PropertyDef, value: unknown): Coerced {
  switch (def.fieldType) {
    case 'long_text': {
      const t = asText(value);
      if (t === null) return bad('must be text');
      return t.length > LONG_TEXT_MAX
        ? bad(`must be at most ${LONG_TEXT_MAX} characters`)
        : good(t);
    }
    case 'integer':
    case 'big_integer': {
      const n = asNumber(value);
      if (n === null) return bad('must be a number');
      return Number.isInteger(n) ? good(n) : bad('must be a whole number');
    }
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating': {
      const n = asNumber(value);
      return n === null ? bad('must be a number') : good(n);
    }
    case 'boolean':
    case 'checkbox': {
      if (typeof value === 'boolean') return good(value);
      if (value === 'true' || value === 'false') return good(value === 'true');
      return bad('must be true or false');
    }
    case 'date': {
      const t = asText(value);
      const m = t === null ? null : DATE.exec(t);
      return m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))
        ? good(t)
        : bad('must be a date as YYYY-MM-DD');
    }
    case 'datetime': {
      const t = asText(value);
      const m = t === null ? null : DATETIME.exec(t);
      const ok =
        m !== null &&
        validDate(Number(m[1]), Number(m[2]), Number(m[3])) &&
        Number(m[4]) < 24 &&
        Number(m[5]) < 60;
      return ok ? good(t) : bad('must be a date and time as YYYY-MM-DDTHH:mm');
    }
    case 'email': {
      const t = asText(value);
      return t !== null && EMAIL.test(t) && t.length <= TEXT_MAX
        ? good(t)
        : bad('must be an email address');
    }
    case 'url': {
      const t = asText(value);
      return t !== null && t.length <= TEXT_MAX && validUrl(t)
        ? good(t)
        : bad('must be a link starting with http:// or https://');
    }
    case 'select':
    case 'radio': {
      const t = typeof value === 'string' ? value : null;
      return t !== null && def.options.includes(t) ? good(t) : bad('must be one of its options');
    }
    case 'multiselect': {
      const list = Array.isArray(value) ? value : null;
      if (!list || !list.every((v) => typeof v === 'string' && def.options.includes(v))) {
        return bad('must be a list of its options');
      }
      return good([...new Set(list as string[])]);
    }
    default: {
      // text, phone, timezone, lookup: one line of text.
      const t = asText(value);
      if (t === null) return bad('must be text');
      return t.length > TEXT_MAX ? bad(`must be at most ${TEXT_MAX} characters`) : good(t);
    }
  }
}

/**
 * Checks a bulk update's `customFields` against the workspace's editable properties and turns it into what to write.
 * Nothing is written until every key and value passes, so a bad one sinks the whole request, not a part of it:
 *  - a key that is not an editable property (unknown, inactive, system, hidden, read-only, formula): 422 CON_PROPERTY_NOT_EDITABLE;
 *  - a value that does not fit the type: 422 VALIDATION_FAILED, one `customFields.<key>` per problem.
 */
export function planPropertyChanges(
  defs: ReadonlyMap<string, PropertyDef>,
  input: Record<string, unknown>,
): PropertyPlan {
  const unknown = Object.keys(input).filter((k) => !defs.has(k));
  if (unknown.length > 0) {
    throw new AppError(
      ERROR_CODES.CON_PROPERTY_NOT_EDITABLE,
      `Not an active custom property: ${unknown.join(', ')}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      unknown.map((k) => ({ path: `customFields.${k}`, message: 'not an editable property' })),
    );
  }
  const plan: PropertyPlan = { set: {}, clear: [] };
  const problems: Array<{ path: string; message: string }> = [];
  for (const [key, value] of Object.entries(input)) {
    if (isClearValue(value)) {
      plan.clear.push(key);
      continue;
    }
    const r = coercePropertyValue(defs.get(key)!, value);
    if (r.ok) plan.set[key] = r.value;
    else problems.push({ path: `customFields.${key}`, message: r.message });
  }
  if (problems.length > 0) {
    throw AppError.validation(
      `Invalid value for: ${problems.map((p) => p.path.replace('customFields.', '')).join(', ')}.`,
      problems,
    );
  }
  return plan;
}

/** The data a contact holds after the plan: its other keys untouched, cleared keys removed. */
export function applyPropertyPlan(
  data: Record<string, unknown>,
  plan: PropertyPlan,
): { data: Record<string, unknown>; changedKeys: string[] } {
  const next: Record<string, unknown> = { ...data, ...plan.set };
  for (const key of plan.clear) delete next[key];
  const changedKeys = [...Object.keys(plan.set), ...plan.clear].filter(
    (k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(next[k] ?? null),
  );
  return { data: next, changedKeys };
}

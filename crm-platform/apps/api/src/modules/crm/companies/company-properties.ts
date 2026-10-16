import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type FieldType } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
// The required-property rules are the contacts module's pure file, imported directly: its index re-exports the contacts service, which
// imports the company link check (a cycle through the companies repository, which only needs this file's types).
import { isBlank, missingRequired, type RequiredRule } from '../contacts/required-properties';

/**
 * A company property (Settings, Company properties) as the write rules need it: the registry row (`fields`, module `companies`), its
 * visible option values and the "show only when" conditions that make it apply. Pure data, so the rules below test without a database.
 */
export interface CompanyPropertyDef {
  key: string;
  label: string;
  fieldType: FieldType;
  isRequired: boolean;
  isHidden: boolean;
  isReadOnly: boolean;
  isActive: boolean;
  isSystem: boolean;
  /**
   * The workspace hides this property's value on screen (a secret, an account number). It is then left out of filters, orders and
   * exports, which would otherwise let a value be guessed or copied out.
   */
  isMasked?: boolean;
  /** Values of the options a person may pick (select, radio, multi-select). */
  options: string[];
  conditions: Array<{ parentKey: string; wanted: string | null }>;
}

type Problem = { path: string; message: string };
type Values = Record<string, unknown>;

/** Types a person can fill in. A computed property is never written, and a hidden, read-only, inactive or system one is not editable. */
export const isEditableProperty = (d: CompanyPropertyDef): boolean =>
  d.isActive && !d.isSystem && !d.isHidden && !d.isReadOnly && d.fieldType !== 'formula';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(text);
}

/** What is wrong with one value for its property's type, as a short reason, or null when it fits. */
export function valueProblem(def: CompanyPropertyDef, value: unknown): string | null {
  switch (def.fieldType) {
    case 'integer':
    case 'big_integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? null
        : 'must be a whole number';
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'boolean':
    case 'checkbox':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'date':
      return typeof value === 'string' && isDate(value) ? null : 'must be a date (YYYY-MM-DD)';
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : 'must be a date and time';
    case 'url':
      return typeof value === 'string' && isUrl(value)
        ? null
        : 'must be a web address (http or https)';
    case 'email':
      return typeof value === 'string' && EMAIL.test(value) ? null : 'must be an email address';
    case 'select':
    case 'radio':
      return typeof value === 'string' && def.options.includes(value)
        ? null
        : 'must be one of the options';
    case 'multiselect':
      return Array.isArray(value) &&
        value.every((v) => typeof v === 'string' && def.options.includes(v))
        ? null
        : 'must be a list of the options';
    default:
      return typeof value === 'string' ? null : 'must be text';
  }
}

/** A value that stores nothing: no value, blank text, an empty list, or an unticked box (the key is removed, as on a contact). */
const clears = (v: unknown): boolean => isBlank(v) || v === false;

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface MergedProperties {
  /** The stored values after the write. */
  next: Values;
  /** The keys whose value changed (set or cleared). */
  changed: string[];
}

/**
 * Applies a write of custom values to what the company holds (`current`): a key sent changes, a cleared one is removed, a key left out
 * keeps its value. Only keys whose value CHANGES are held to the property's flags and type, so a form that sends back everything it
 * loaded still saves (a property deactivated since, or one that other writers filled with a value the type no longer accepts, never
 * blocks an unrelated save). Throws 422 COMPANY_PROPERTY_NOT_EDITABLE / COMPANY_PROPERTY_INVALID naming each `customFields.<key>`.
 */
export function mergeProperties(
  defs: readonly CompanyPropertyDef[],
  incoming: Values,
  current: Values,
): MergedProperties {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const next: Values = { ...current };
  const changed: string[] = [];
  const notEditable: Problem[] = [];
  const invalid: Problem[] = [];
  for (const [key, raw] of Object.entries(incoming)) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const stored = clears(value) ? null : value;
    if (same(stored, clears(current[key]) ? null : current[key])) continue;
    const def = byKey.get(key);
    if (!def || !isEditableProperty(def)) {
      notEditable.push({ path: `customFields.${key}`, message: 'not an editable property' });
      continue;
    }
    if (stored !== null) {
      const why = valueProblem(def, stored);
      if (why) {
        invalid.push({ path: `customFields.${key}`, message: why });
        continue;
      }
      next[key] = stored;
    } else {
      delete next[key];
    }
    changed.push(key);
  }
  if (notEditable.length > 0) {
    throw new AppError(
      ERROR_CODES.COMPANY_PROPERTY_NOT_EDITABLE,
      `Not an editable company property: ${notEditable.map((p) => p.path.replace('customFields.', '')).join(', ')}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      notEditable,
    );
  }
  if (invalid.length > 0) {
    throw new AppError(
      ERROR_CODES.COMPANY_PROPERTY_INVALID,
      `A value does not fit its property: ${invalid.map((p) => p.path.replace('customFields.', '')).join(', ')}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      invalid,
    );
  }
  return { next, changed };
}

/**
 * The properties the registry marks required that a write can be held to: active, visible, user-settable, and not a checkbox (an unticked
 * box is an answer), with the conditions that make each apply.
 */
export function requiredRulesOf(defs: readonly CompanyPropertyDef[]): RequiredRule[] {
  return defs
    .filter(
      (d) =>
        d.isRequired &&
        isEditableProperty(d) &&
        d.fieldType !== 'checkbox' &&
        d.fieldType !== 'boolean',
    )
    .map((d) => ({ key: d.key, label: d.label, conditions: d.conditions }));
}

/** 422 COMPANY_REQUIRED_PROPERTY_MISSING naming every missing key (`customFields.<key>`), so a form can mark each field. */
export function assertRequiredProperties(defs: readonly CompanyPropertyDef[], data: Values): void {
  const missing = missingRequired(requiredRulesOf(defs), data);
  if (missing.length === 0) return;
  throw new AppError(
    ERROR_CODES.COMPANY_REQUIRED_PROPERTY_MISSING,
    `Required properties are missing: ${missing.map((m) => m.label).join(', ')}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    missing.map((m) => ({ path: `customFields.${m.key}`, message: 'required' })),
  );
}

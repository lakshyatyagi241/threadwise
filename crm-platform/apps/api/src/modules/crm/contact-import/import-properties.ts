import { normalizeImportHeader } from '@crm/contracts';
import type { PropertyDef } from '../contacts/contact-property-values';

/** A custom contact property as the import reads it: the column its values come from (null: the file has none). */
export interface ImportProperty extends PropertyDef {
  column: number | null;
}

const TRUE = /^(true|yes|y|1|x|on)$/i;
const FALSE = /^(false|no|n|0|off)$/i;

/** `attr:tier` (the header the export writes for a property) is read as `tier`. */
const headerKey = (header: string): string =>
  normalizeImportHeader(header.replace(/^\s*attr\s*:/i, ''));

/**
 * Which column fills each custom property. An explicit request wins (null ignores that property). Otherwise a property takes the
 * column whose header is its label or its key. A column a built-in field already reads is never taken, and one column fills one
 * property at most.
 */
export function resolvePropertyColumns(
  headers: readonly string[],
  defs: readonly PropertyDef[],
  builtinColumns: ReadonlySet<number>,
  requested?: Record<string, number | null>,
): ImportProperty[] {
  const taken = new Set(builtinColumns);
  const columns = new Map<string, number | null>();
  for (const def of defs) {
    // Own keys only: a property keyed `constructor` or `toString` must not read a method off the request object.
    const want =
      requested && Object.prototype.hasOwnProperty.call(requested, def.key)
        ? requested[def.key]
        : undefined;
    if (want === undefined) continue;
    if (want !== null && want < headers.length && !taken.has(want)) {
      taken.add(want);
      columns.set(def.key, want);
    } else columns.set(def.key, null);
  }
  for (const def of defs) {
    if (columns.has(def.key)) continue;
    const wanted = new Set([def.label, def.key].map(normalizeImportHeader).filter(Boolean));
    const index = headers.findIndex((h, i) => !taken.has(i) && wanted.has(headerKey(h)));
    if (index >= 0) taken.add(index);
    columns.set(def.key, index >= 0 ? index : null);
  }
  return defs.map((def) => ({ ...def, column: columns.get(def.key) ?? null }));
}

/** The option a cell names, matched without regard to case; a cell that names none is passed on as it is (so the write rules refuse it). */
function optionOf(def: PropertyDef, text: string): string {
  return def.options.find((o) => o.toLowerCase() === text.toLowerCase()) ?? text;
}

/**
 * One cell as the value of its property, read the way the file writes it. Blank is `undefined` (the cell says nothing). A cell that
 * cannot be read as the property's type is passed on as text, so `coercePropertyValue` refuses it with its usual message.
 */
export function cellToPropertyValue(def: PropertyDef, cell: string): unknown {
  const text = cell.trim();
  if (text === '') return undefined;
  switch (def.fieldType) {
    case 'integer':
    case 'big_integer':
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating': {
      // A comma is a thousands separator only when it groups digits in threes (1,250.5). Any other comma ("12,5") is not read
      // as a thousands separator: it stays text, so the row is refused rather than stored as 125.
      const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text);
      const n = Number(grouped ? text.replace(/,/g, '') : text);
      return Number.isFinite(n) ? n : text;
    }
    case 'boolean':
    case 'checkbox':
      return TRUE.test(text) ? true : FALSE.test(text) ? false : text;
    case 'select':
    case 'radio':
      return optionOf(def, text);
    case 'multiselect': {
      // The export joins a list with commas; an option that holds a comma is read whole when the cell names it exactly.
      if (def.options.some((o) => o.toLowerCase() === text.toLowerCase()))
        return [optionOf(def, text)];
      const parts = text
        .split(/[;|,]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => optionOf(def, p));
      return parts.length > 0 ? parts : undefined;
    }
    default:
      return text;
  }
}

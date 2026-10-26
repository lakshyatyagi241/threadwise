import { normalizeImportDate } from '@crm/contracts';
import type { PropertyDef } from '../contacts/contact-property-values';
import { normaliseHeader, readBooleanCell, readNumberCell } from '../property-csv-cells';

/** A custom contact property as the import reads it: the column its values come from (null: the file has none). */
export interface ImportProperty extends PropertyDef {
  column: number | null;
}

/** `attr:tier` (the header the export writes for a property) is read as `tier`. */
const headerKey = (header: string): string => normaliseHeader(header.replace(/^\s*attr\s*:/i, ''));

/** The key an `attr:<key>` header names, trimmed and lower-cased (exactly as written, unlike `headerKey`); null for any other header. */
const exactAttrKey = (header: string): string | null => {
  const m = /^\s*attr\s*:(.*)$/i.exec(header);
  return m ? m[1]!.trim().toLowerCase() : null;
};

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
  // The export's own header (`attr:<key>`) names one property by its exact key, so it is matched before any label, in any property order.
  // A label that reads alike cannot send the column elsewhere, and keys that differ only in punctuation stay apart.
  for (const def of defs) {
    if (columns.has(def.key)) continue;
    const want = def.key.trim().toLowerCase();
    if (want === '') continue;
    const index = headers.findIndex((h, i) => !taken.has(i) && exactAttrKey(h) === want);
    if (index >= 0) {
      taken.add(index);
      columns.set(def.key, index);
    }
  }
  for (const def of defs) {
    if (columns.has(def.key)) continue;
    const wanted = new Set([def.label, def.key].map(normaliseHeader).filter(Boolean));
    const index = headers.findIndex((h, i) => !taken.has(i) && wanted.has(headerKey(h)));
    if (index >= 0) taken.add(index);
    columns.set(def.key, index >= 0 ? index : null);
  }
  return defs.map((def) => ({ ...def, column: columns.get(def.key) ?? null }));
}

/**
 * A cell as the sample file's guard leaves it: an apostrophe in front of text that starts like a formula (`'=x`) is not part of the
 * value, so `=x` is what the cell names.
 */
const unguardedCell = (text: string): string => (/^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text);

/** An option's name for comparing: accents, case, and runs of spaces (a no-break space too) do not matter. */
const optionKey = (text: string): string =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The option a cell names, matched without regard to case, accents, extra spaces, guard apostrophe or not; undefined when it names
 * none. An exact (case-insensitive) match wins over the looser one.
 */
function optionNamed(def: PropertyDef, text: string): string | undefined {
  const exact = (t: string) => def.options.find((o) => o.toLowerCase() === t.toLowerCase());
  const loose = (t: string) => def.options.find((o) => optionKey(o) === optionKey(t));
  return exact(text) ?? exact(unguardedCell(text)) ?? loose(text) ?? loose(unguardedCell(text));
}

/** The option a cell names, or the cell as it is when it names none (so the write rules refuse it). */
function optionOf(def: PropertyDef, text: string): string {
  return optionNamed(def, text) ?? text;
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
    case 'rating':
      return readNumberCell(text);
    case 'boolean':
    case 'checkbox':
      return readBooleanCell(text);
    case 'select':
    case 'radio':
      return optionOf(def, text);
    case 'multiselect': {
      // The export joins a list with commas; an option that holds a comma is read whole when the cell names it exactly.
      const whole = optionNamed(def, text);
      if (whole !== undefined) return [whole];
      const parts = text
        .split(/[;|,]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => optionOf(def, p));
      return parts.length > 0 ? parts : undefined;
    }
    case 'date':
      // A spreadsheet writes 14-05-1990 back for 1990-05-14: a date that cannot be read two ways is accepted as the day it names.
      return normalizeImportDate(text) ?? text;
    default:
      return text;
  }
}

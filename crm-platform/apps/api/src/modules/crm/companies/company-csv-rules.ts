import {
  COMPANY_EXPORT_COLUMNS,
  COMPANY_EXPORT_PROPERTY_PREFIX,
  type CompanyExportColumn,
} from '@crm/contracts';
import { isEditableProperty, type CompanyPropertyDef } from './company-properties';

/**
 * Pure rules of the companies CSV (export columns, import header mapping, cell to property value), kept apart from the service so a
 * unit test can pin them without a database.
 */

/** Header names that mean a built-in column, after `normaliseHeader`. */
const BUILTIN_ALIASES = {
  name: ['name', 'companyname', 'company'],
  website: ['website', 'site', 'url', 'domain', 'web'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'phonenumber', 'telephone', 'mobile'],
  industry: ['industry', 'sector'],
  sizeRange: ['size', 'sizerange', 'companysize', 'employees'],
  address: ['address'],
  notes: ['notes', 'note'],
  owner: ['owner', 'ownername', 'owneremail', 'accountowner'],
} as const;

export type ImportField = keyof typeof BUILTIN_ALIASES;

export const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export type ImportTarget =
  { kind: 'builtin'; field: ImportField } | { kind: 'property'; def: CompanyPropertyDef };

export interface HeaderMap {
  /** One entry per column of the file: where its cells go, or null when they are ignored. */
  columns: Array<ImportTarget | null>;
  /** The header names that matched nothing (or repeated a column already used). */
  ignored: string[];
}

/**
 * Where each column of the file goes. A built-in name wins over a property of the same name; a property is matched by its label or
 * its key, and only an editable one can be written. A column named twice is read once (the first), the rest are ignored and said so.
 */
export function mapHeaders(
  headers: readonly string[],
  defs: readonly CompanyPropertyDef[],
): HeaderMap {
  const editable = defs.filter(isEditableProperty);
  const used = new Set<string>();
  const ignored: string[] = [];
  const columns = headers.map((raw): ImportTarget | null => {
    const h = normaliseHeader(raw);
    if (h === '') return null;
    for (const [field, aliases] of Object.entries(BUILTIN_ALIASES)) {
      if ((aliases as readonly string[]).includes(h)) {
        if (used.has(field)) break;
        used.add(field);
        return { kind: 'builtin', field: field as ImportField };
      }
    }
    const def = editable.find(
      (d) => normaliseHeader(d.label) === h || normaliseHeader(d.key) === h,
    );
    if (def && !used.has(`property:${def.key}`)) {
      used.add(`property:${def.key}`);
      return { kind: 'property', def };
    }
    ignored.push(raw.trim());
    return null;
  });
  return { columns, ignored };
}

const TRUE = /^(true|yes|y|1|x|on)$/i;
const FALSE = /^(false|no|n|0|off)$/i;

/**
 * A cell as the value of its property. Blank is `undefined` (the cell says nothing). A value that cannot be read as the property's type
 * is passed on as text, so the shared write rules (`mergeProperties`) refuse it with their usual message instead of this guessing.
 * An option is matched without regard to case, and a list of options may be separated by `;` or `|`.
 */
export function cellToPropertyValue(def: CompanyPropertyDef, cell: string): unknown {
  const text = cell.trim();
  if (text === '') return undefined;
  switch (def.fieldType) {
    case 'integer':
    case 'big_integer':
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating': {
      const n = Number(text.replace(/,/g, ''));
      return Number.isFinite(n) ? n : text;
    }
    case 'boolean':
    case 'checkbox':
      return TRUE.test(text) ? true : FALSE.test(text) ? false : text;
    case 'select':
    case 'radio':
      return def.options.find((o) => o.toLowerCase() === text.toLowerCase()) ?? text;
    case 'multiselect':
      return text
        .split(/[;|]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => def.options.find((o) => o.toLowerCase() === part.toLowerCase()) ?? part);
    default:
      return text;
  }
}

/** The cell of a stored value: lists joined with `; `, a checkbox as `true`, nothing as an empty cell. */
export function propertyToCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(propertyToCell).filter(Boolean).join('; ');
  if (typeof value === 'object') return '';
  return String(value);
}

export interface ExportColumn {
  /** The id the request used (`name`, `property:tier`). */
  id: string;
  header: string;
  /** A free-text column gets the spreadsheet formula guard; a phone, a date or a number must not (a leading + is not a formula). */
  text: boolean;
}

/**
 * The columns of an export, in file order. Without a request: every built-in column and then every property. A request names columns
 * in the order wanted; an unknown one is returned in `unknown` (the service refuses it).
 */
export function exportColumns(
  requested: readonly string[] | undefined,
  defs: readonly CompanyPropertyDef[],
): { columns: ExportColumn[]; unknown: string[] } {
  // A masked property is not copied out, a computed one is not stored.
  const stored = defs.filter((d) => d.isActive && !d.isMasked && d.fieldType !== 'formula');
  const byProperty = new Map(stored.map((d) => [`${COMPANY_EXPORT_PROPERTY_PREFIX}${d.key}`, d]));
  const builtin = (id: CompanyExportColumn): ExportColumn => ({
    id,
    header: id,
    text: id !== 'phone' && id !== 'createdAt',
  });
  const ids = requested ?? [
    ...COMPANY_EXPORT_COLUMNS,
    ...stored.map((d) => `${COMPANY_EXPORT_PROPERTY_PREFIX}${d.key}`),
  ];
  const columns: ExportColumn[] = [];
  const unknown: string[] = [];
  for (const id of new Set(ids)) {
    if ((COMPANY_EXPORT_COLUMNS as readonly string[]).includes(id)) {
      columns.push(builtin(id as CompanyExportColumn));
      continue;
    }
    const def = byProperty.get(id);
    if (def) columns.push({ id, header: def.label, text: true });
    else unknown.push(id);
  }
  return { columns, unknown };
}

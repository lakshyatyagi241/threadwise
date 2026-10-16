/**
 * Which columns the Companies table shows ("Columns", BL-196). The choice is a list of column ids kept in localStorage; everything
 * about turning it into columns, and into the columns of an export, is here so it can be tested without a browser.
 *
 * The first visit shows exactly the table Reference has (Company, Industry, Contacts, Open deals, Won value); the rest are offered:
 * the company's own details, its owner, and every company property of the workspace.
 */

export const FIXED_COLUMN_IDS = [
  'company',
  'industry',
  'website',
  'email',
  'phone',
  'size',
  'owner',
  'created',
  'contacts',
  'openDeals',
  'wonValue',
] as const;
export type FixedColumnId = (typeof FIXED_COLUMN_IDS)[number];
export type ColumnId = FixedColumnId | `prop:${string}`;

/** The company name cannot be hidden: it is the row's link to the company. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['company'];

/** Visible on first visit: Reference's table. */
export const DEFAULT_COLUMNS: readonly ColumnId[] = [
  'company',
  'industry',
  'contacts',
  'openDeals',
  'wonValue',
];

export const STORAGE_KEY = 'companies:columns';

/** A company property as the columns need it. */
export interface PropertyColumn {
  key: string;
  label: string;
}

export interface ColumnDef {
  id: ColumnId;
  /** Fixed columns: a message key under `companies.table`. A property brings its own label. */
  label: { key: string } | { text: string };
  propertyKey?: string;
}

export const propId = (key: string): ColumnId => `prop:${key}`;
export const isPropId = (id: string): id is `prop:${string}` => id.startsWith('prop:');

const FIXED_LABEL: Record<FixedColumnId, string> = {
  company: 'company',
  industry: 'industry',
  website: 'website',
  email: 'email',
  phone: 'phone',
  size: 'size',
  owner: 'owner',
  created: 'created',
  contacts: 'contacts',
  openDeals: 'openDeals',
  wonValue: 'wonValue',
};

/**
 * Every column that can exist, in display order: the company, its details, the workspace's properties, then the figures. The figures
 * (contacts, open deals, won value) stay at the end where Reference has them.
 */
export function allColumns(properties: readonly PropertyColumn[]): ColumnDef[] {
  const fixed = (id: FixedColumnId): ColumnDef => ({ id, label: { key: FIXED_LABEL[id] } });
  return [
    fixed('company'),
    fixed('industry'),
    fixed('website'),
    fixed('email'),
    fixed('phone'),
    fixed('size'),
    fixed('owner'),
    ...properties.map((p): ColumnDef => ({
      id: propId(p.key),
      label: { text: p.label },
      propertyKey: p.key,
    })),
    fixed('created'),
    fixed('contacts'),
    fixed('openDeals'),
    fixed('wonValue'),
  ];
}

/** Reads the stored value; anything malformed counts as "never chosen" (null). */
export function parseStoredColumns(raw: string | null): ColumnId[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null;
    return v as ColumnId[];
  } catch {
    return null;
  }
}

export const serializeColumns = (ids: readonly ColumnId[]): string => JSON.stringify(ids);

/**
 * The columns to draw: stored (or default) ids in canonical order, without ids that no longer exist (a deleted or deactivated
 * property), with the locked ones always on.
 */
export function visibleColumns(
  stored: readonly ColumnId[] | null,
  properties: readonly PropertyColumn[],
): ColumnDef[] {
  const chosen = new Set<ColumnId>([...(stored ?? DEFAULT_COLUMNS), ...LOCKED_COLUMNS]);
  return allColumns(properties).filter((c) => chosen.has(c.id));
}

const EXPORT_ID: Partial<Record<FixedColumnId, string>> = {
  company: 'name',
  industry: 'industry',
  website: 'website',
  email: 'email',
  phone: 'phone',
  size: 'sizeRange',
  owner: 'owner',
  created: 'createdAt',
};

/**
 * The export columns that match what the table shows, in table order: a figure of the table (contacts, open deals, won value) has no
 * column in a file; a property is `property:<key>`.
 */
export function exportColumnIds(columns: readonly ColumnDef[]): string[] {
  const out: string[] = [];
  for (const c of columns) {
    if (isPropId(c.id)) out.push(`property:${c.id.slice('prop:'.length)}`);
    else {
      const id = EXPORT_ID[c.id as FixedColumnId];
      if (id) out.push(id);
    }
  }
  return out;
}

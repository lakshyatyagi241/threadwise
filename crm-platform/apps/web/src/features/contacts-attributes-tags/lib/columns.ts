/**
 * Which columns the contacts table shows ("Modify columns"). The choice is a list of column ids kept in
 * localStorage; everything about turning it into columns is here so it can be tested without a browser.
 */

export const FIXED_COLUMN_IDS = [
  'name',
  'phone',
  'email',
  'tags',
  'groups',
  'stage',
  'language',
  'memo',
  'createdOn',
] as const;
export type FixedColumnId = (typeof FIXED_COLUMN_IDS)[number];
export type ColumnId = FixedColumnId | `attr:${string}`;

/** The name column cannot be hidden: it is the row's link to the contact. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['name'];

/** Visible on first visit (plus the first two custom attributes, see `defaultColumns`). */
export const DEFAULT_FIXED: readonly FixedColumnId[] = ['name', 'phone', 'email', 'tags', 'createdOn'];

/** How many custom attribute columns a first-time visitor sees. */
export const DEFAULT_ATTRIBUTE_COLUMNS = 2;

export const STORAGE_KEY = 'cat:contacts:columns';

export interface AttributeColumn {
  key: string;
  name: string;
}

export interface ColumnDef {
  id: ColumnId;
  /** Fixed columns: a message key under `contacts-attributes-tags.list`. Attributes: their own name. */
  label: { key: string } | { text: string };
  attributeKey?: string;
}

export const attrId = (key: string): ColumnId => `attr:${key}`;
export const isAttrId = (id: string): id is `attr:${string}` => id.startsWith('attr:');

const FIXED_LABEL: Record<FixedColumnId, string> = {
  name: 'colContactName',
  phone: 'colPhone',
  email: 'colEmailId',
  tags: 'colTags',
  groups: 'colGroups',
  stage: 'colStage',
  language: 'colLanguage',
  memo: 'colMemo',
  createdOn: 'colCreatedOn',
};

/**
 * Every column that can exist, in display order: name, phone, the workspace's attributes, then email, tags, and the
 * rest. Attribute columns sit next to the phone because order-style attributes read as part of the contact's identity.
 */
export function allColumns(attributes: readonly AttributeColumn[]): ColumnDef[] {
  const fixed = (id: FixedColumnId): ColumnDef => ({ id, label: { key: FIXED_LABEL[id] } });
  return [
    fixed('name'),
    fixed('phone'),
    ...attributes.map(
      (a): ColumnDef => ({ id: attrId(a.key), label: { text: a.name }, attributeKey: a.key }),
    ),
    fixed('email'),
    fixed('tags'),
    fixed('groups'),
    fixed('stage'),
    fixed('language'),
    fixed('memo'),
    fixed('createdOn'),
  ];
}

export function defaultColumns(attributes: readonly AttributeColumn[]): ColumnId[] {
  return [
    ...DEFAULT_FIXED,
    ...attributes.slice(0, DEFAULT_ATTRIBUTE_COLUMNS).map((a) => attrId(a.key)),
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

export function serializeColumns(ids: readonly ColumnId[]): string {
  return JSON.stringify(ids);
}

/**
 * The columns to draw: stored (or default) ids, in canonical order, without ids that no longer exist (a deleted
 * attribute), with the locked ones always on.
 */
export function visibleColumns(
  stored: readonly ColumnId[] | null,
  attributes: readonly AttributeColumn[],
): ColumnDef[] {
  const chosen = new Set<ColumnId>([...(stored ?? defaultColumns(attributes)), ...LOCKED_COLUMNS]);
  return allColumns(attributes).filter((c) => chosen.has(c.id));
}

/** Flips one column. The result is what to store; locked columns are left alone. */
export function toggleColumn(
  current: readonly ColumnId[],
  id: ColumnId,
  on: boolean,
): ColumnId[] {
  if (LOCKED_COLUMNS.includes(id)) return [...current];
  const rest = current.filter((c) => c !== id);
  return on ? [...rest, id] : rest;
}

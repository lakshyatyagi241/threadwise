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
  'status',
  'owner',
  'leadScore',
  'language',
  'memo',
  // BL-190 / BL-211: offered, hidden until chosen. Neither can be sorted.
  'dateOfBirth',
  'minor',
  'createdOn',
] as const;
export type FixedColumnId = (typeof FIXED_COLUMN_IDS)[number];
export type ColumnId = FixedColumnId | `attr:${string}`;

/** The name column cannot be hidden: it is the row's link to the contact. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['name'];

/**
 * Visible on first visit (plus the first two custom attributes, see `defaultColumns`). The owner column is offered but starts
 * hidden: Reference's contact list has no owner column (its `user_id` is the creator and is never shown), so a workspace that
 * does not use owners sees the table it always had.
 */
export const DEFAULT_FIXED: readonly FixedColumnId[] = [
  'name',
  'phone',
  'email',
  'tags',
  'stage',
  'status',
  'leadScore',
  'createdOn',
];

/** How many custom attribute columns a first-time visitor sees. */
export const DEFAULT_ATTRIBUTE_COLUMNS = 2;

export const STORAGE_KEY = 'cat:contacts:columns';
/** The left-to-right order the person arranged (a list of column ids); absent until they move one. */
export const ORDER_STORAGE_KEY = 'cat:contacts:column-order';

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
  status: 'colStatus',
  owner: 'colOwner',
  leadScore: 'colLeadScore',
  language: 'colLanguage',
  memo: 'colMemo',
  dateOfBirth: 'colDateOfBirth',
  minor: 'colMinor',
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
    ...attributes.map((a): ColumnDef => ({
      id: attrId(a.key),
      label: { text: a.name },
      attributeKey: a.key,
    })),
    fixed('email'),
    fixed('tags'),
    fixed('groups'),
    fixed('stage'),
    fixed('status'),
    fixed('owner'),
    fixed('leadScore'),
    fixed('language'),
    fixed('memo'),
    fixed('dateOfBirth'),
    fixed('minor'),
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
  order: readonly ColumnId[] | null = null,
): ColumnDef[] {
  const chosen = new Set<ColumnId>([...(stored ?? defaultColumns(attributes)), ...LOCKED_COLUMNS]);
  const canonical = allColumns(attributes).filter((c) => chosen.has(c.id));
  if (!order || order.length === 0) return canonical;
  // Arranged columns first, in the arranged order; one the person never placed (turned on later, a new attribute)
  // follows in its usual order. The name column stays first: the checkbox column and the freeze edge sit beside it.
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const placed = canonical
    .filter((c) => rank.has(c.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = canonical.filter((c) => !rank.has(c.id));
  const all = [...placed, ...rest];
  const locked = all.filter((c) => LOCKED_COLUMNS.includes(c.id));
  return [...locked, ...all.filter((c) => !LOCKED_COLUMNS.includes(c.id))];
}

/**
 * Moves `id` to where `target` is (dragging a header onto another, or the arrow keys). Locked columns neither move nor
 * can be passed, so nothing lands before the name. Returns the ids to store; the same list when nothing changes.
 */
export function moveColumn(
  visible: readonly ColumnId[],
  id: ColumnId,
  target: ColumnId,
): ColumnId[] {
  const from = visible.indexOf(id);
  const to = visible.indexOf(target);
  if (from < 0 || to < 0 || from === to || LOCKED_COLUMNS.includes(id)) return [...visible];
  const next = visible.filter((c) => c !== id);
  const lockedCount = next.filter((c) => LOCKED_COLUMNS.includes(c)).length;
  next.splice(Math.max(to, lockedCount), 0, id);
  return next;
}

/** One step left (-1) or right (1) for the keyboard. */
export function nudgeColumn(visible: readonly ColumnId[], id: ColumnId, step: -1 | 1): ColumnId[] {
  const at = visible.indexOf(id);
  const target = visible[at + step];
  return at < 0 || target === undefined ? [...visible] : moveColumn(visible, id, target);
}

/** The API sort a header click asks for; null for columns that cannot be sorted (many values per contact). */
export function sortKeyOf(id: ColumnId): string | null {
  if (isAttrId(id)) return /^attr:[a-z0-9_]{1,64}$/.test(id) ? id : null;
  switch (id) {
    // Many values per contact, or (lead score, owner) not orderable by the API yet: an owner sort needs the person's name
    // from another table and has no index, so it waits for a need.
    case 'tags':
    case 'groups':
    case 'leadScore':
    case 'owner':
    case 'dateOfBirth':
    case 'minor':
      return null;
    case 'createdOn':
      return 'createdAt';
    default:
      return id;
  }
}

/** Flips one column. The result is what to store; locked columns are left alone. */
export function toggleColumn(current: readonly ColumnId[], id: ColumnId, on: boolean): ColumnId[] {
  if (LOCKED_COLUMNS.includes(id)) return [...current];
  const rest = current.filter((c) => c !== id);
  return on ? [...rest, id] : rest;
}

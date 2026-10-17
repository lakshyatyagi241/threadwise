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
  // BL-190 / BL-217: offered, hidden until chosen. Neither can be sorted.
  'dateOfBirth',
  'minor',
  'createdOn',
  'whatsapp',
  'sms',
  'emailOptIn',
  'company',
  'lastActivity',
  'source',
] as const;
export type FixedColumnId = (typeof FIXED_COLUMN_IDS)[number];
export type ColumnId = FixedColumnId | `attr:${string}`;

/** The name column cannot be hidden: it is the row's link to the contact. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['name'];

/**
 * Visible on first visit: the seven of the Contact Hub's slim table (name, phone, email, lifecycle stage, WhatsApp opt-in,
 * owner, created at). Everything else is one click away in the "+" picker; a person's own choice always wins.
 */
export const DEFAULT_FIXED: readonly FixedColumnId[] = [
  'name',
  'phone',
  'email',
  'stage',
  'whatsapp',
  'owner',
  'createdOn',
];

/** How many custom attribute columns a first-time visitor sees: none, the add-column picker offers them. */
export const DEFAULT_ATTRIBUTE_COLUMNS = 0;

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
  /** A shorter heading for the table (the full label is its tooltip), so a narrow column never reads "PHONE NU...". */
  short?: { key: string };
  attributeKey?: string;
}

export const attrId = (key: string): ColumnId => `attr:${key}`;
export const isAttrId = (id: string): id is `attr:${string}` => id.startsWith('attr:');

const NO_COLUMNS: ReadonlySet<ColumnId> = new Set();

const FIXED_LABEL: Record<FixedColumnId, string> = {
  name: 'colContactName',
  phone: 'colPhone',
  email: 'colEmailId',
  tags: 'colTags',
  groups: 'colGroups',
  stage: 'colLifecycleStage',
  status: 'colStatus',
  owner: 'colOwner',
  leadScore: 'colLeadScore',
  language: 'colLanguage',
  memo: 'colMemo',
  dateOfBirth: 'colDateOfBirth',
  minor: 'colMinor',
  createdOn: 'colCreatedOn',
  whatsapp: 'colWhatsapp',
  sms: 'colSms',
  emailOptIn: 'colEmailOptIn',
  company: 'colCompany',
  lastActivity: 'colLastActivity',
  source: 'colSource',
};

/** The columns whose heading is shortened in the table header; the full label stays in the picker and as the tooltip. */
const SHORT_LABEL: Partial<Record<FixedColumnId, string>> = {
  phone: 'shortPhone',
  email: 'shortEmail',
  stage: 'shortStage',
  whatsapp: 'shortWhatsapp',
  createdOn: 'shortCreated',
};

/**
 * Every column that can exist, in display order: name, phone, the workspace's attributes, then email, tags, and the
 * rest. Attribute columns sit next to the phone because order-style attributes read as part of the contact's identity.
 */
export function allColumns(
  attributes: readonly AttributeColumn[],
  omit: ReadonlySet<ColumnId> = NO_COLUMNS,
): ColumnDef[] {
  const fixed = (id: FixedColumnId): ColumnDef => ({
    id,
    label: { key: FIXED_LABEL[id] },
    ...(SHORT_LABEL[id] ? { short: { key: SHORT_LABEL[id]! } } : {}),
  });
  return (
    [
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
      fixed('whatsapp'),
      fixed('sms'),
      fixed('emailOptIn'),
      fixed('owner'),
      fixed('leadScore'),
      fixed('company'),
      fixed('language'),
      fixed('memo'),
      fixed('source'),
      fixed('dateOfBirth'),
      fixed('minor'),
      fixed('lastActivity'),
      fixed('createdOn'),
    ] as ColumnDef[]
  ).filter((c) => !omit.has(c.id));
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
  /** Columns this person cannot have (the company column without access to companies). */
  omit: ReadonlySet<ColumnId> = NO_COLUMNS,
): ColumnDef[] {
  const chosen = new Set<ColumnId>([...(stored ?? defaultColumns(attributes)), ...LOCKED_COLUMNS]);
  const canonical = allColumns(attributes, omit).filter((c) => chosen.has(c.id));
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
    case 'whatsapp':
    case 'sms':
    case 'emailOptIn':
    case 'company':
    case 'lastActivity':
    case 'source':
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

/** The groups of the add-column picker, in the order it lists them. */
export const COLUMN_GROUPS = [
  'contact',
  'lifecycle',
  'related',
  'consent',
  'activity',
  'custom',
] as const;
export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

/** Which picker group a column belongs to. */
export function columnGroup(id: ColumnId): ColumnGroup {
  if (isAttrId(id)) return 'custom';
  switch (id) {
    case 'name':
    case 'phone':
    case 'email':
    case 'language':
    case 'memo':
    case 'source':
    case 'dateOfBirth':
      return 'contact';
    case 'stage':
    case 'status':
    case 'owner':
    case 'leadScore':
      return 'lifecycle';
    case 'company':
    case 'tags':
    case 'groups':
      return 'related';
    case 'whatsapp':
    case 'sms':
    case 'emailOptIn':
    case 'minor':
      return 'consent';
    case 'lastActivity':
    case 'createdOn':
      return 'activity';
  }
}

/**
 * The columns the add-column picker can still add, grouped: every column that exists and is not shown yet, in the
 * canonical order, empty groups left out.
 */
export function addableColumns(
  all: readonly ColumnDef[],
  shown: readonly ColumnId[],
): Array<{ group: ColumnGroup; columns: ColumnDef[] }> {
  const on = new Set(shown);
  const out: Array<{ group: ColumnGroup; columns: ColumnDef[] }> = [];
  for (const group of COLUMN_GROUPS) {
    const columns = all.filter((c) => !on.has(c.id) && columnGroup(c.id) === group);
    if (columns.length > 0) out.push({ group, columns });
  }
  return out;
}

/** The shown columns with `id` taken out (the header menu's "Hide"); the locked ones stay. */
export function hideColumn(shown: readonly ColumnId[], id: ColumnId): ColumnId[] {
  return LOCKED_COLUMNS.includes(id) ? [...shown] : shown.filter((c) => c !== id);
}

/** The shown columns with `id` added at the end (the "+" picker). Already shown: unchanged. */
export function showColumn(shown: readonly ColumnId[], id: ColumnId): ColumnId[] {
  return shown.includes(id) ? [...shown] : [...shown, id];
}

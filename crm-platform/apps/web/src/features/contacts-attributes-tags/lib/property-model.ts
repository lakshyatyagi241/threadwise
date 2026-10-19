import {
  RESERVED_ATTRIBUTE_KEYS,
  type CreateFieldInput,
  type FieldDependencyResponse,
  type FieldOptionResponse,
  type FieldResponse,
  type FieldSectionResponse,
  type FieldType,
  type ModuleKey,
  type UpdateFieldInput,
} from '@crm/contracts';
import { ATTRIBUTE_KEY, ATTRIBUTE_KEY_MAX } from './attribute-model';
import { displayValue } from './field-values';
import { moveItem, valueFromLabel } from './stage-model';

/**
 * Pure rules of the "Contact properties" screen: which types can be created, how properties group under sections,
 * the draft the property form edits, its validation, and the diff of an edited option list.
 */

/** Types offered when creating a property, in the order of the type picker. */
export const CREATABLE_TYPES = [
  'text',
  'long_text',
  'integer',
  'decimal',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'url',
  'email',
  'phone',
] as const satisfies readonly FieldType[];
export type CreatableType = (typeof CREATABLE_TYPES)[number];

const OPTION_TYPES: ReadonlySet<string> = new Set(['select', 'multiselect', 'radio']);
export const isOptionType = (type: string): boolean => OPTION_TYPES.has(type);

export const LABEL_MAX = 255;
export const OPTION_LABEL_MAX = 255;
export const DESCRIPTION_MAX = 300;

/** The properties every contact has and the form always shows; they are not rows of the registry. */
export interface BuiltInProperty {
  key: string;
  type: FieldType;
  required: boolean;
  /** Where the property's choices or values are managed, when it is not here. */
  manage?: '/contact-stages' | '/contact-groups';
}

export const BUILT_IN_PROPERTIES: readonly BuiltInProperty[] = [
  { key: 'first_name', type: 'text', required: true },
  { key: 'last_name', type: 'text', required: false },
  { key: 'phone', type: 'phone', required: true },
  { key: 'email', type: 'email', required: false },
  { key: 'title', type: 'select', required: false },
  { key: 'middle_name', type: 'text', required: false },
  { key: 'language', type: 'text', required: false },
  { key: 'address', type: 'long_text', required: false },
  { key: 'memo', type: 'long_text', required: false },
  { key: 'source', type: 'text', required: false },
  { key: 'lifecycle_stage', type: 'select', required: false, manage: '/contact-stages' },
  { key: 'status', type: 'select', required: false, manage: '/contact-stages' },
  { key: 'groups', type: 'multiselect', required: false, manage: '/contact-groups' },
  { key: 'owner', type: 'select', required: false },
  { key: 'opt_out', type: 'checkbox', required: false },
];

/** A property the contact form and detail page can show: a registry row that is a custom property and not hidden. */
export const isUsable = (f: FieldResponse): boolean => f.isActive && !f.isSystem;

export interface SectionGroup {
  /** `null` = properties that have no section. */
  section: FieldSectionResponse | null;
  fields: FieldResponse[];
}

/**
 * Properties under their sections: sections in their saved order (empty ones included, so they can be managed),
 * properties in theirs, and properties with no section last.
 */
export function groupBySection(
  sections: readonly FieldSectionResponse[],
  fields: readonly FieldResponse[],
): SectionGroup[] {
  const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
  const known = new Set(sections.map((s) => s.id));
  const groups: SectionGroup[] = [...sections].sort(byPosition).map((section) => ({
    section,
    fields: fields.filter((f) => f.sectionId === section.id).sort(byPosition),
  }));
  const loose = fields
    .filter((f) => f.sectionId === null || !known.has(f.sectionId))
    .sort(byPosition);
  if (loose.length > 0) groups.push({ section: null, fields: loose });
  return groups;
}

/** The text a search matches: label, key and description. */
export function matchesSearch(f: FieldResponse, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return true;
  const description = typeof f.config.description === 'string' ? f.config.description : '';
  return `${f.label} ${f.key} ${description}`.toLocaleLowerCase().includes(needle);
}

// --- the property form ------------------------------------------------------------------------------------------

export interface DraftOption {
  /** Present for an option that already exists. */
  id?: string;
  /** What contacts store. Fixed once the option exists. */
  value: string;
  label: string;
}

export interface DraftCondition {
  /** Present for a dependency that already exists. */
  id?: string;
  fieldId: string;
  optionId: string | null;
  value: string;
}

export interface PropertyDraft {
  label: string;
  key: string;
  type: FieldType;
  sectionId: string;
  description: string;
  required: boolean;
  visible: boolean;
  readOnly: boolean;
  active: boolean;
  options: DraftOption[];
  conditions: DraftCondition[];
}

export function emptyDraft(sectionId: string): PropertyDraft {
  return {
    label: '',
    key: '',
    type: 'text',
    sectionId,
    description: '',
    required: false,
    visible: true,
    readOnly: false,
    active: true,
    options: [],
    conditions: [],
  };
}

export function draftFromField(
  f: FieldResponse,
  dependencies: readonly FieldDependencyResponse[],
): PropertyDraft {
  return {
    label: f.label,
    key: f.key,
    type: f.fieldType,
    sectionId: f.sectionId ?? '',
    description: typeof f.config.description === 'string' ? f.config.description : '',
    required: f.isRequired,
    visible: !f.isHidden,
    readOnly: f.isReadOnly,
    active: f.isActive,
    options: [...(f.options ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, value: o.value, label: o.label })),
    conditions: dependencies
      .filter((d) => d.fieldId === f.id)
      .map((d) => ({
        id: d.id,
        fieldId: d.dependsOnFieldId,
        optionId: d.dependsOnOptionId,
        value: d.dependsOnValue ?? '',
      })),
  };
}

export type KeyProblem = 'required' | 'format' | 'tooLong' | 'taken' | 'reserved';
export type OptionsProblem = 'required' | 'emptyLabel' | 'duplicate';

export interface DraftProblems {
  label?: 'required' | 'tooLong';
  key?: KeyProblem;
  section?: 'required';
  options?: OptionsProblem;
  condition?: 'incomplete';
}

/** Checks a draft before it is sent. `takenKeys` are the keys of every property that already exists (any state). */
export function checkDraft(
  d: PropertyDraft,
  opts: { editing: boolean; takenKeys: ReadonlySet<string> },
): DraftProblems {
  const out: DraftProblems = {};
  const label = d.label.trim();
  if (!label) out.label = 'required';
  else if (label.length > LABEL_MAX) out.label = 'tooLong';

  if (!opts.editing) {
    const key = d.key.trim();
    if (!key) out.key = 'required';
    else if (key.length > ATTRIBUTE_KEY_MAX) out.key = 'tooLong';
    else if (!ATTRIBUTE_KEY.test(key)) out.key = 'format';
    else if (RESERVED_ATTRIBUTE_KEYS.has(key)) out.key = 'reserved';
    else if (opts.takenKeys.has(key)) out.key = 'taken';
  }
  if (!d.sectionId) out.section = 'required';

  if (isOptionType(d.type)) {
    const labels = d.options.map((o) => o.label.trim().toLocaleLowerCase());
    if (d.options.length === 0) out.options = 'required';
    else if (labels.some((l) => l === '')) out.options = 'emptyLabel';
    else if (new Set(labels).size !== labels.length) out.options = 'duplicate';
  }
  if (d.conditions.some((c) => !c.fieldId || (c.optionId === null && c.value.trim() === ''))) {
    out.condition = 'incomplete';
  }
  return out;
}

export const hasProblems = (p: DraftProblems): boolean => Object.keys(p).length > 0;

/** A value key for a new option, unique among the draft's options. */
export function newOptionValue(label: string, options: readonly DraftOption[]): string {
  return valueFromLabel(
    label,
    options.map((o) => o.value),
  );
}

/** Config of a property after the form: everything it already had, with the description set or removed. */
export function configFromDraft(
  current: Record<string, unknown>,
  description: string,
): Record<string, unknown> {
  const rest = { ...current };
  delete rest.description;
  const text = description.trim();
  return text ? { ...rest, description: text } : rest;
}

export function toCreateBody(
  d: PropertyDraft,
  moduleKey: ModuleKey = 'contacts',
): CreateFieldInput {
  return {
    moduleKey,
    sectionId: d.sectionId,
    key: d.key.trim(),
    label: d.label.trim(),
    fieldType: d.type,
    isRequired: d.required,
    isHidden: !d.visible,
    isReadOnly: d.readOnly,
    isMasked: false,
    isUnique: false,
    isQuickCreate: false,
    isGlobalSearch: false,
    config: configFromDraft({}, d.description),
    ...(isOptionType(d.type)
      ? {
          options: d.options.map((o, i) => ({
            value: o.value,
            label: o.label.trim(),
            position: i,
          })),
        }
      : {}),
  };
}

export function toUpdateBody(
  d: PropertyDraft,
  f: Pick<FieldResponse, 'config' | 'rowVersion'>,
): UpdateFieldInput {
  return {
    label: d.label.trim(),
    sectionId: d.sectionId,
    isRequired: d.required,
    isHidden: !d.visible,
    isReadOnly: d.readOnly,
    isActive: d.active,
    config: configFromDraft(f.config, d.description),
    rowVersion: f.rowVersion,
  };
}

export interface OptionDiff {
  create: DraftOption[];
  rename: Array<{ option: FieldOptionResponse; label: string }>;
  remove: FieldOptionResponse[];
}

/** What to send to turn a field's saved options into the edited list: new ones, renamed ones, dropped ones. */
export function diffOptions(
  saved: readonly FieldOptionResponse[],
  edited: readonly DraftOption[],
): OptionDiff {
  const kept = new Set(edited.filter((o) => o.id).map((o) => o.id));
  const byId = new Map(saved.map((o) => [o.id, o]));
  return {
    create: edited.filter((o) => !o.id),
    rename: edited.flatMap((o) => {
      const was = o.id ? byId.get(o.id) : undefined;
      return was && was.label !== o.label.trim() ? [{ option: was, label: o.label.trim() }] : [];
    }),
    remove: saved.filter((o) => !kept.has(o.id)),
  };
}

export interface ConditionDiff {
  create: DraftCondition[];
  remove: string[];
}

/** Dependencies to add (no id yet) and to remove (saved ones no longer in the form). */
export function diffConditions(
  saved: readonly FieldDependencyResponse[],
  edited: readonly DraftCondition[],
): ConditionDiff {
  const kept = new Set(edited.filter((c) => c.id).map((c) => c.id));
  return {
    create: edited.filter((c) => !c.id),
    remove: saved.filter((d) => !kept.has(d.id)).map((d) => d.id),
  };
}

/** How a dependency reads in the list: "Shown when Country is India". */
export function describeCondition(
  d: FieldDependencyResponse,
  fieldsById: ReadonlyMap<string, FieldResponse>,
): { field: string; value: string } | null {
  const parent = fieldsById.get(d.dependsOnFieldId);
  if (!parent) return null;
  const option = parent.options?.find((o) => o.id === d.dependsOnOptionId);
  return { field: parent.label, value: option?.label ?? d.dependsOnValue ?? '' };
}

/** Warns when a property is used by others: those that depend on it. */
export const dependentsOf = (
  fieldId: string,
  dependencies: readonly FieldDependencyResponse[],
): string[] => dependencies.filter((d) => d.dependsOnFieldId === fieldId).map((d) => d.fieldId);

/**
 * The full order of a section's properties after moving `id` to where `targetId` is. The list on screen can be
 * filtered (search, inactive hidden) but a reorder always sends every property of the section, so positions never
 * collide with the ones that are not shown.
 */
export function moveRelative(all: readonly string[], id: string, targetId: string): string[] {
  const from = all.indexOf(id);
  const to = all.indexOf(targetId);
  if (from < 0 || to < 0) return [...all];
  return moveItem(all, from, to);
}

export interface DetailRow {
  key: string;
  label: string;
  value: string;
}

export interface DetailGroup {
  /** Section name; `null` for values with no property behind them or no section. */
  title: string | null;
  rows: DetailRow[];
}

/**
 * The custom values of a contact for its profile page: the workspace's visible properties that have a value, in
 * section order, then any other value the contact holds (imported under a key with no property). Values of a
 * hidden or inactive property are not shown (they are kept).
 */
export function detailGroups(
  fields: readonly FieldResponse[],
  sections: readonly FieldSectionResponse[],
  customFields: Readonly<Record<string, unknown>>,
  skipKeys: ReadonlySet<string>,
  words: { yes: string; no: string },
  keyLabel: (key: string) => string,
): DetailGroup[] {
  const groups: DetailGroup[] = [];
  for (const g of groupBySection(
    sections,
    fields.filter((f) => isUsable(f) && !f.isHidden),
  )) {
    const rows = g.fields.flatMap((f) => {
      const value = displayValue(f, customFields[f.key], words);
      return value ? [{ key: f.key, label: f.label, value }] : [];
    });
    if (rows.length) groups.push({ title: g.section?.name ?? null, rows });
  }
  const known = new Set(fields.map((f) => f.key));
  const rest: DetailRow[] = [];
  for (const [key, raw] of Object.entries(customFields)) {
    if (known.has(key) || skipKeys.has(key.toLowerCase())) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      const value = String(raw);
      if (value !== '') rest.push({ key, label: keyLabel(key), value });
    }
  }
  if (rest.length) groups.push({ title: null, rows: rest });
  return groups;
}

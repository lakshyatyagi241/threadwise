import {
  SEGMENT_BUILTIN_FIELDS,
  SEGMENT_COMPANY_PREFIX,
  SEGMENT_CUSTOM_PREFIX,
  isCustomSegmentField,
  segmentKindForFieldType,
  type FieldType,
  type SegmentBuiltinField,
} from '@crm/contracts';
import { operatorsForKind, type FieldKind, type Operator } from './operators';
import type { Condition, EditorValue, Group } from './model';
import { conditionsOf } from './model';

/**
 * The fields a segment can test: the same ones the contacts list filters by, plus the workspace's custom properties.
 * The catalog is built from the lookups the screen has loaded (stages, statuses, tags, groups, people, properties), so
 * the pickers show real choices and a reference to something deleted can be told from one that never existed.
 */

export type FieldGroup = 'journey' | 'who' | 'activity' | 'properties' | 'company';
export const FIELD_GROUPS: readonly FieldGroup[] = [
  'journey',
  'who',
  'activity',
  'properties',
  'company',
];

export interface Choice {
  value: string;
  label: string;
  /** Hex colour of a stage, tag or group. */
  color?: string;
}

export type OptionSource = 'stage' | 'status' | 'tag' | 'group' | 'user' | 'property';

export interface FieldDef {
  id: string;
  group: FieldGroup;
  kind: FieldKind;
  /** System fields name a message key (`segments.fields.<key>`); a custom property brings its own label. */
  label: { key: string } | { text: string };
  operators: readonly Operator[];
  /** Choices of an `option`, `user`, `tags`, `groups` or `multi` field. */
  options?: readonly Choice[];
  optionsFrom?: OptionSource;
}

/** The workspace's custom property as the catalog needs it (a `FieldResponse` of the contacts module, trimmed). */
export interface PropertyLookup {
  key: string;
  label: string;
  fieldType: FieldType;
  options: readonly Choice[];
}

export interface Lookups {
  stages: readonly Choice[];
  statuses: readonly Choice[];
  tags: readonly Choice[];
  groups: readonly Choice[];
  users: readonly Choice[];
  properties: readonly PropertyLookup[];
  /** The workspace's company properties: a rule on one reads the company the contact belongs to (BL-196). */
  companyProperties?: readonly PropertyLookup[];
}

const without = (ops: readonly Operator[], drop: readonly Operator[]) =>
  ops.filter((o) => !drop.includes(o));

export const PROPERTY_PREFIX = SEGMENT_CUSTOM_PREFIX;
export const propertyFieldId = (key: string) => `${PROPERTY_PREFIX}${key}`;
export const isPropertyField = (id: string) => isCustomSegmentField(id);
export const companyFieldId = (key: string) => `${SEGMENT_COMPANY_PREFIX}${key}`;

/** Every field a condition can test, grouped as the picker shows them: Journey, Who, Activity, Properties. */
export function buildCatalog(l: Lookups): FieldDef[] {
  const sys = (
    id: SegmentBuiltinField,
    group: FieldGroup,
    extra: Partial<FieldDef> = {},
  ): FieldDef => {
    const kind = SEGMENT_BUILTIN_FIELDS[id];
    return { id, group, kind, label: { key: id }, operators: operatorsForKind(kind), ...extra };
  };
  const never = ['is_empty', 'is_not_empty'] as const;
  const system: FieldDef[] = [
    sys('lifecycleStage', 'journey', { options: l.stages, optionsFrom: 'stage' }),
    sys('status', 'journey', { options: l.statuses, optionsFrom: 'status' }),
    sys('leadScore', 'journey'),
    sys('name', 'who'),
    sys('email', 'who'),
    sys('phone', 'who'),
    sys('countryCode', 'who'),
    sys('search', 'who'),
    sys('tags', 'who', { options: l.tags, optionsFrom: 'tag' }),
    sys('groups', 'who', { options: l.groups, optionsFrom: 'group' }),
    sys('owner', 'who', { options: l.users, optionsFrom: 'user' }),
    sys('source', 'who'),
    sys('timezone', 'who'),
    sys('unsubscribed', 'who'),
    sys('imported', 'who'),
    sys('minor', 'who'),
    sys('dateOfBirth', 'who'),
    sys('age', 'who'),
    // created and updated are always set, so "is empty" would never match
    sys('createdAt', 'activity', { operators: without(operatorsForKind('date'), never) }),
    sys('updatedAt', 'activity', { operators: without(operatorsForKind('date'), never) }),
    sys('lastActivityAt', 'activity'),
  ];
  const fromProperties = (
    props: readonly PropertyLookup[],
    group: FieldGroup,
    idOf: (key: string) => string,
  ): FieldDef[] =>
    props.flatMap((p): FieldDef[] => {
      const kind = segmentKindForFieldType(p.fieldType);
      if (!kind) return [];
      return [
        {
          id: idOf(p.key),
          group,
          kind,
          label: { text: p.label },
          operators: operatorsForKind(kind),
          ...(kind === 'option' || kind === 'multi'
            ? { options: p.options, optionsFrom: 'property' as const }
            : {}),
        },
      ];
    });
  return [
    ...system,
    ...fromProperties(l.properties, 'properties', propertyFieldId),
    ...fromProperties(l.companyProperties ?? [], 'company', companyFieldId),
  ];
}

export function fieldsByGroup(
  catalog: readonly FieldDef[],
): Array<{ group: FieldGroup; fields: FieldDef[] }> {
  return FIELD_GROUPS.map((group) => ({
    group,
    fields: catalog.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);
}

export const findField = (catalog: readonly FieldDef[], id: string): FieldDef | undefined =>
  catalog.find((f) => f.id === id);

export const kindLookup =
  (catalog: readonly FieldDef[]) =>
  (id: string): FieldDef['kind'] | null =>
    findField(catalog, id)?.kind ?? null;

// --- references to things that no longer exist ---------------------------------------------------------------------

export type InvalidReason =
  /** The field itself is gone (a deleted or deactivated custom property). */
  | { type: 'field' }
  /** One or more chosen values are gone (a deleted tag, group, stage, status, person or option). */
  | { type: 'values'; missing: string[] };

const selectedValues = (value: EditorValue): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' && value !== '' ? [value] : [];

/**
 * The conditions whose reference was deleted since the segment was written, keyed by condition id. Only meaningful once
 * the lookups behind the catalog have loaded: with an empty option list nothing is judged missing.
 */
export function invalidConditions(
  root: Group,
  catalog: readonly FieldDef[],
  loaded: boolean,
): Map<string, InvalidReason> {
  const out = new Map<string, InvalidReason>();
  if (!loaded) return out;
  for (const c of conditionsOf(root)) {
    const field = findField(catalog, c.field);
    if (!field) {
      out.set(c.id, { type: 'field' });
      continue;
    }
    if (!field.options) continue;
    const known = new Set(field.options.map((o) => o.value));
    const missing = selectedValues(c.value).filter((v) => !known.has(v));
    if (missing.length > 0) out.set(c.id, { type: 'values', missing });
  }
  return out;
}

/** The condition with its deleted values taken out (an `equals` on a deleted value is left alone: the person picks again). */
export function dropMissingValues(c: Condition, missing: readonly string[]): Condition {
  if (!Array.isArray(c.value)) return { ...c, value: '' };
  return { ...c, value: c.value.filter((v) => !missing.includes(v)) };
}

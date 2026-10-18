import { ASSIGNMENT_FIELDS, DEAL_STATUSES_FOR_ASSIGNMENT } from '@crm/contracts';
import {
  operatorsForKind,
  propertyFieldId,
  propertyFields,
  type Choice,
  type FieldDef,
  type Operator,
  type PropertyLookup,
} from '@/features/segments';
import { ORIGINS } from './subjects';

/**
 * The fields a rule can test, per module, in the shape the segments rule builder reads (`FieldDef`). Contacts reuse the segments catalog
 * (minus the fields the engine does not take) and gain "arrived through"; companies and deals get catalogs of their own. System field
 * labels arrive as text from the caller (it owns the translations), so these builders are plain functions.
 */

export interface PipelineChoice {
  id: string;
  name: string;
  stages: ReadonlyArray<{ id: string; name: string }>;
}

const NEVER_EMPTY: readonly Operator[] = ['is_empty', 'is_not_empty'];
const dateOps = (id: string): readonly Operator[] =>
  id === 'createdAt' || id === 'updatedAt'
    ? // created and updated are always set, so "is empty" would never match
      operatorsForKind('date').filter((o) => !NEVER_EMPTY.includes(o))
    : operatorsForKind('date');

const opsFor = (id: string, kind: FieldDef['kind']) =>
  kind === 'date' ? dateOps(id) : operatorsForKind(kind);

/** `origin` is not stored on a record: it is how the record arrived, known when the rule runs. */
export function originField(label: string, originLabel: (origin: string) => string): FieldDef {
  return {
    id: 'origin',
    group: 'journey',
    kind: 'option',
    label: { text: label },
    operators: operatorsForKind('option'),
    options: ORIGINS.map((o) => ({ value: o, label: originLabel(o) })),
  };
}

/** The segments catalog narrowed to what a contact rule takes (no owner: the rule decides it; no free-text search), plus origin. */
export function contactCatalog(base: readonly FieldDef[], origin: FieldDef): FieldDef[] {
  const allowed = new Set(Object.keys(ASSIGNMENT_FIELDS.contact));
  const keep = base.filter(
    (f) => allowed.has(f.id) || f.id.startsWith('custom.') || f.id.startsWith('company.'),
  );
  return [...keep.filter((f) => f.id !== 'origin'), origin];
}

export interface CompanyCatalogInput {
  label: (field: string) => string;
  origin: FieldDef;
  properties: readonly PropertyLookup[];
}

export function companyCatalog({ label, origin, properties }: CompanyCatalogInput): FieldDef[] {
  const own: FieldDef[] = Object.entries(ASSIGNMENT_FIELDS.company)
    .filter(([id]) => id !== 'origin')
    .map(([id, kind]) => ({
      id,
      group: 'record' as const,
      kind,
      label: { text: label(id) },
      operators: opsFor(id, kind),
    }));
  return [...own, origin, ...propertyFields(properties, 'properties', propertyFieldId)];
}

export interface DealCatalogInput {
  label: (field: string) => string;
  statusLabel: (status: string) => string;
  origin: FieldDef;
  pipelines: readonly PipelineChoice[];
}

export function dealCatalog({
  label,
  statusLabel,
  origin,
  pipelines,
}: DealCatalogInput): FieldDef[] {
  const options = (id: string): Pick<FieldDef, 'options'> | Record<string, never> => {
    if (id === 'pipeline')
      return { options: pipelines.map((p): Choice => ({ value: p.id, label: p.name })) };
    if (id === 'stage')
      return {
        options: pipelines.flatMap((p) =>
          p.stages.map((s): Choice => ({ value: s.id, label: `${p.name} › ${s.name}` })),
        ),
      };
    if (id === 'status')
      return {
        options: DEAL_STATUSES_FOR_ASSIGNMENT.map((s): Choice => ({
          value: s,
          label: statusLabel(s),
        })),
      };
    return {};
  };
  const own: FieldDef[] = Object.entries(ASSIGNMENT_FIELDS.deal)
    .filter(([id]) => id !== 'origin')
    .map(([id, kind]) => ({
      id,
      group: 'record' as const,
      kind,
      label: { text: label(id) },
      operators: opsFor(id, kind),
      ...options(id),
    }));
  return [...own, origin];
}

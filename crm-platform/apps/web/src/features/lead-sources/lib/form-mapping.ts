import type {
  LeadFieldMapping,
  LeadSourceResponse,
  MetaLeadQuestion,
  UpdateLeadSourceInput,
} from '@crm/contracts';
import { MAPPING_FIELDS, PROPERTY_KEY, type MappingField } from './draft';

/**
 * The "Map fields" dialog of a Meta lead form: one row per question of the form, each sent to one contact field, one contact
 * property, or nowhere (the pipeline then looks under the common names by itself). These functions turn a source's stored mapping
 * into those rows and back, so the dialog holds no rules of its own.
 *
 * A stored mapping points a contact field at a PATH in the lead's answers; for a Meta form the path of an answer is the question's
 * key. So the rows are the mapping read backwards: for each question, which target points at its key. Paths that are not a question
 * key of this form (typed by hand on the source page, or one of Meta's own `meta_*` ids) are kept as they are.
 */

/** The select's value for "not mapped by me". */
export const IGNORE = '';
const PROPERTY_PREFIX = 'property:';

/** `''` (ignore), a contact field (`email`) or `property:<contact property key>`. */
export type TargetValue = string;

export const propertyTarget = (key: string): TargetValue => `${PROPERTY_PREFIX}${key}`;

export type ParsedTarget =
  { kind: 'none' } | { kind: 'field'; field: MappingField } | { kind: 'property'; key: string };

export function parseTarget(value: TargetValue): ParsedTarget {
  if (value.startsWith(PROPERTY_PREFIX)) {
    const key = value.slice(PROPERTY_PREFIX.length);
    return key === '' ? { kind: 'none' } : { kind: 'property', key };
  }
  const field = MAPPING_FIELDS.find((f) => f === value);
  return field ? { kind: 'field', field } : { kind: 'none' };
}

export interface QuestionRow {
  key: string;
  label: string;
  /** Meta's question type (`FULL_NAME`, `EMAIL`, `CUSTOM`, ...). */
  type: string;
  target: TargetValue;
}

export interface RowsResult {
  rows: QuestionRow[];
  /** True when nothing in the stored mapping pointed at this form's questions, so the rows come from Meta's own suggestions. */
  fromSuggestions: boolean;
  /** Question keys the stored mapping used for more than one target; only the first survives a save. */
  multiUse: string[];
}

const trimmed = (v: string | undefined): string => v?.trim() ?? '';

/** Every (target, path) pair a mapping holds, contact fields first, then custom properties in the order stored. */
function targetsOf(mapping: LeadFieldMapping | undefined): Array<[TargetValue, string]> {
  const out: Array<[TargetValue, string]> = [];
  if (!mapping) return out;
  for (const f of MAPPING_FIELDS) {
    const path = trimmed(mapping[f]);
    if (path !== '') out.push([f, path]);
  }
  for (const [key, raw] of Object.entries(mapping.customFields ?? {})) {
    const path = trimmed(raw);
    if (path !== '') out.push([propertyTarget(key), path]);
  }
  return out;
}

export function rowsFromMapping(
  questions: readonly MetaLeadQuestion[],
  mapping: LeadFieldMapping | undefined,
): RowsResult {
  const stored = targetsOf(mapping);
  const byQuestion = new Map<string, TargetValue[]>();
  for (const [target, path] of stored) {
    byQuestion.set(path, [...(byQuestion.get(path) ?? []), target]);
  }
  const matched = questions.some((q) => byQuestion.has(q.key));
  // A target the stored mapping already fills from a path of its own is not offered again as a suggestion.
  const taken = new Set<TargetValue>(stored.map(([target]) => target));

  const rows: QuestionRow[] = questions.map((q) => {
    const row = { key: q.key, label: q.label, type: q.type };
    const own = byQuestion.get(q.key);
    if (own) return { ...row, target: own[0]! };
    if (!matched && q.suggestedTarget && !taken.has(q.suggestedTarget)) {
      taken.add(q.suggestedTarget);
      return { ...row, target: q.suggestedTarget };
    }
    return { ...row, target: IGNORE };
  });

  const multiUse = questions
    .filter((q) => (byQuestion.get(q.key)?.length ?? 0) > 1)
    .map((q) => q.key);
  return { rows, fromSuggestions: !matched, multiUse };
}

// --- checking the rows --------------------------------------------------------------------------------------------------------

export type RowProblem =
  /** Another question already goes to the same contact field or property. */
  | { code: 'duplicateTarget'; target: TargetValue }
  /** A property key the contract would refuse. */
  | { code: 'propertyKey'; target: TargetValue };

/** `question key -> problem`, for every row that cannot be saved as chosen. The first question to claim a target keeps it. */
export function rowProblems(rows: readonly QuestionRow[]): Record<string, RowProblem> {
  const out: Record<string, RowProblem> = {};
  const claimed = new Set<TargetValue>();
  for (const row of rows) {
    const parsed = parseTarget(row.target);
    if (parsed.kind === 'none') continue;
    if (parsed.kind === 'property' && !PROPERTY_KEY.test(parsed.key)) {
      out[row.key] = { code: 'propertyKey', target: row.target };
      continue;
    }
    if (claimed.has(row.target)) out[row.key] = { code: 'duplicateTarget', target: row.target };
    else claimed.add(row.target);
  }
  return out;
}

// --- rows -> mapping ----------------------------------------------------------------------------------------------------------

export type MappingResult =
  { ok: true; mapping: LeadFieldMapping } | { ok: false; problems: Record<string, RowProblem> };

/**
 * The mapping to save. Starts from the stored one and takes out every entry that points at one of this form's question keys (those
 * are what the rows now say), keeps the entries that point anywhere else and the attribution as they are, then adds the rows. A row
 * set that sends two questions to one target, or names an impossible property key, is refused.
 */
export function mappingFromRows(
  rows: readonly QuestionRow[],
  existing: LeadFieldMapping | undefined,
): MappingResult {
  const problems = rowProblems(rows);
  if (Object.keys(problems).length > 0) return { ok: false, problems };

  const questionKeys = new Set(rows.map((r) => r.key));
  const out: LeadFieldMapping = {};
  const custom: Record<string, string> = {};

  for (const f of MAPPING_FIELDS) {
    const path = trimmed(existing?.[f]);
    if (path !== '' && !questionKeys.has(path)) out[f] = path;
  }
  for (const [key, raw] of Object.entries(existing?.customFields ?? {})) {
    const path = trimmed(raw);
    if (path !== '' && !questionKeys.has(path)) custom[key] = path;
  }

  for (const row of rows) {
    const parsed = parseTarget(row.target);
    if (parsed.kind === 'field') out[parsed.field] = row.key;
    else if (parsed.kind === 'property') custom[parsed.key] = row.key;
  }

  if (Object.keys(custom).length > 0) out.customFields = custom;
  if (existing?.attribution && Object.keys(existing.attribution).length > 0) {
    out.attribution = { ...existing.attribution };
  }
  return { ok: true, mapping: out };
}

const canonical = (m: LeadFieldMapping | undefined): string => {
  const sorted = (o: Record<string, string | undefined> | undefined) =>
    Object.entries(o ?? {})
      .filter(([, v]) => trimmed(v) !== '')
      .sort(([a], [b]) => a.localeCompare(b));
  const { customFields, attribution, ...fields } = m ?? {};
  return JSON.stringify([sorted(fields), sorted(customFields), sorted(attribution)]);
};

/** True when two mappings say the same thing (key order and blank entries do not count). */
export const sameMapping = (a: LeadFieldMapping | undefined, b: LeadFieldMapping | undefined) =>
  canonical(a) === canonical(b);

export type MappingUpdateResult =
  { ok: true; body: UpdateLeadSourceInput } | { ok: false; problems: Record<string, RowProblem> };

/** The request that saves the rows: only `mapping`, with the row version the source was read at. */
export function mappingUpdateFromRows(
  rows: readonly QuestionRow[],
  source: Pick<LeadSourceResponse, 'mapping' | 'rowVersion'>,
): MappingUpdateResult {
  const result = mappingFromRows(rows, source.mapping);
  if (!result.ok) return result;
  return { ok: true, body: { rowVersion: source.rowVersion, mapping: result.mapping } };
}

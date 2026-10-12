import type { FieldDependencyResponse, FieldResponse } from '@crm/contracts';
import {
  EMPTY_DRAFT,
  editorKindOf,
  parseDraft,
  type Draft,
  type PropertyErrorKey,
} from './property-values';

/**
 * The properties a workspace marks required are part of creating a contact: the API refuses a new contact that has no value for
 * one (422 CON_REQUIRED_PROPERTY_MISSING). These are the same rules the API applies (`required-properties.ts` and
 * `requiredRules` in apps/api), so the form asks for exactly what the server will ask for, before anything is sent.
 */

/** Types the API never counts as missing: a switch always has an answer and a formula is computed. */
const NEVER_ASKED: ReadonlySet<string> = new Set(['formula', 'checkbox', 'boolean']);

/** What a person has typed or picked so far, by property key. */
export type Drafts = Readonly<Record<string, Draft | undefined>>;

/** The properties a new contact must have a value for, in the registry's order: the API's own query. */
export function requiredFieldsOf(fields: readonly FieldResponse[]): FieldResponse[] {
  return fields
    .filter(
      (f) =>
        f.isRequired &&
        f.isActive &&
        !f.isSystem &&
        !f.isHidden &&
        !f.isReadOnly &&
        !NEVER_ASKED.has(f.fieldType),
    )
    .sort((a, b) => a.position - b.position);
}

/** What a draft holds, as the strings a dependency is compared with. */
export function heldOf(field: FieldResponse, draft: Draft | undefined): string[] {
  if (!draft) return [];
  const kind = editorKindOf(field.fieldType);
  if (kind === 'single' || kind === 'multi') return draft.picked;
  const text = draft.text.trim();
  return text === '' ? [] : [text];
}

/**
 * Which of the required properties apply to what has been entered. A property that depends on another is only asked for when
 * every one of its conditions holds (the other property has the wanted value); a condition that names no value never holds, so
 * that property is never asked for. A dependency on a property that no longer exists is ignored.
 */
export function applicableFields(
  required: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  allFields: readonly FieldResponse[],
  drafts: Drafts,
): FieldResponse[] {
  const byId = new Map(allFields.map((f) => [f.id, f]));
  return required.filter((field) =>
    dependencies
      .filter((d) => d.fieldId === field.id)
      .every((d) => {
        const parent = byId.get(d.dependsOnFieldId);
        if (!parent) return true;
        const wanted =
          d.dependsOnValue ??
          parent.options?.find((o) => o.id === d.dependsOnOptionId)?.value ??
          null;
        return wanted !== null && heldOf(parent, drafts[parent.key]).includes(wanted);
      }),
  );
}

export interface PropertyProblem {
  error: PropertyErrorKey | 'unsupported';
  params?: Record<string, string | number>;
}

export type Collected =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; problems: Record<string, PropertyProblem> };

/**
 * The `customFields` to send for the properties on screen, or what is wrong with each one that is not right: empty, or a value
 * that does not fit its type. A property the app has no editor for (a link to another record) can never be filled in here, so it
 * is reported rather than sent empty.
 */
export function collectCustomFields(fields: readonly FieldResponse[], drafts: Drafts): Collected {
  const value: Record<string, unknown> = {};
  const problems: Record<string, PropertyProblem> = {};
  for (const field of fields) {
    const draft = drafts[field.key] ?? EMPTY_DRAFT;
    const kind = editorKindOf(field.fieldType);
    if (kind === 'unsupported') {
      problems[field.key] = { error: 'unsupported' };
    } else if (kind === 'single' || kind === 'multi') {
      // The value came from the list of options, so only whether there is one is left to check.
      if (draft.picked.length === 0) {
        problems[field.key] = { error: 'required', params: { label: field.label } };
      } else {
        value[field.key] = kind === 'single' ? draft.picked[0] : [...new Set(draft.picked)];
      }
    } else {
      const parsed = parseDraft(field, draft);
      if (parsed.ok) value[field.key] = parsed.value;
      else problems[field.key] = { error: parsed.error, params: parsed.params };
    }
  }
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, value };
}

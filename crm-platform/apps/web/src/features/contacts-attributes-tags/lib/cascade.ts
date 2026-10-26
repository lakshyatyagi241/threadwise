import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
} from '@crm/contracts';
import { emptyInput, isCascadeLink, type InputValue } from './field-values';

/**
 * Cascading choices (Waboo's "dependent fields"). A cascade child is a property whose choices depend on the choices of its
 * parent property: a cascade link (a field-level dependency with no option and no value) names the parent, and the option pairs
 * name which child choices each parent choice allows. The child always shows; only its list narrows. A parent with no choice held
 * allows none, so the child cannot be chosen until its parent is.
 */

const heldValues = (held: InputValue | undefined): string[] =>
  Array.isArray(held) ? held : held === undefined || held === '' ? [] : [held];

/**
 * The choices a field may take given the values entered so far, or `null` when the field is not a cascade child (all of its choices
 * apply). A cascade child with several parents needs a choice each parent allows. Where a parent's choices are not all loaded (a long
 * list), the field keeps all of its choices rather than guessing: such a parent cannot be matched here.
 */
export function cascadeOptionsOf(
  field: Pick<FieldResponse, 'id' | 'options' | 'optionCount'>,
  dependencies: readonly FieldDependencyResponse[],
  optionPairs: readonly FieldOptionDependencyResponse[],
  fieldsById: ReadonlyMap<string, FieldResponse>,
  values: Readonly<Record<string, InputValue | undefined>>,
): FieldOptionResponse[] | null {
  const parents = dependencies.filter((d) => d.fieldId === field.id && isCascadeLink(d));
  if (parents.length === 0) return null;
  // The child's own choices are not all here (a long list): there is nothing to narrow.
  if ((field.optionCount ?? 0) > (field.options?.length ?? 0)) return null;

  // One set of allowed choice ids per parent; a choice must be allowed by every parent.
  const allowedByParent: ReadonlySet<string>[] = [];
  for (const link of parents) {
    const parent = fieldsById.get(link.dependsOnFieldId);
    if (!parent?.options || (parent.optionCount ?? 0) > parent.options.length) return null;
    const held = heldValues(values[parent.key]);
    const chosen = new Set(parent.options.filter((o) => held.includes(o.value)).map((o) => o.id));
    allowedByParent.push(
      new Set(
        optionPairs
          .filter(
            (p) =>
              p.childFieldId === field.id &&
              p.parentFieldId === parent.id &&
              chosen.has(p.parentOptionId),
          )
          .map((p) => p.childOptionId),
      ),
    );
  }
  return (field.options ?? []).filter((o) => allowedByParent.every((ids) => ids.has(o.id)));
}

/**
 * The fields as the forms draw them: a cascade child lists only the choices its parents allow (`optionCount` follows the list, so
 * it is not mistaken for a long list that is only partly here).
 */
export function withCascadeChoices<F extends FieldResponse>(
  fields: readonly F[],
  dependencies: readonly FieldDependencyResponse[],
  optionPairs: readonly FieldOptionDependencyResponse[],
  values: Readonly<Record<string, InputValue | undefined>>,
): F[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return fields.map((f) => {
    const choices = cascadeOptionsOf(f, dependencies, optionPairs, byId, values);
    return choices === null ? f : { ...f, options: choices, optionCount: choices.length };
  });
}

/**
 * The attribute values after one attribute changed. A cascade child whose held choice the change no longer allows is cleared,
 * repeatedly, since clearing a choice can narrow the next cascade down the chain. Clearing keeps the form honest: a value that is no
 * longer offered is never sent.
 */
export function attributesAfterChange(
  values: Readonly<Record<string, InputValue>>,
  key: string,
  value: InputValue,
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  optionPairs: readonly FieldOptionDependencyResponse[],
): Record<string, InputValue> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  let next: Record<string, InputValue> = { ...values, [key]: value };
  for (let pass = 0; pass <= fields.length; pass++) {
    let changed = false;
    for (const f of fields) {
      const offered = cascadeOptionsOf(f, dependencies, optionPairs, byId, next);
      const held = next[f.key];
      if (offered === null || held === undefined) continue;
      const list = heldValues(held).filter((v) => v !== '');
      if (list.length === 0) continue;
      const allowedValues = new Set(offered.map((o) => o.value));
      if (list.every((v) => allowedValues.has(v))) continue;
      const kept = list.filter((v) => allowedValues.has(v));
      next = { ...next, [f.key]: Array.isArray(held) ? kept : emptyInput(f) };
      changed = true;
    }
    if (!changed) break;
  }
  return next;
}

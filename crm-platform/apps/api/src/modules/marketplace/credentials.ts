import type { MarketRecipe, RecipeAuthField } from '@crm/contracts';

/**
 * The credential fields of an installation, as the recipe declares them (`authFields`). Pure: validation and the hints the manage page
 * shows. A secret field is never returned after it is saved, only "set" and the last four characters; a plain text field (an account id, a
 * region) is not a secret and is shown as it is.
 */

export interface CredentialProblem {
  path: string;
  message: string;
}

/** What the page shows for a field that is set. */
export function hintFor(field: RecipeAuthField, value: string): string {
  if (field.kind !== 'secret') return value.slice(0, 120);
  return value.length >= 8 ? `ends in ${value.slice(-4)}` : 'set';
}

export function checkCredentialValue(field: RecipeAuthField, value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return 'Required';
  if (v.length > 2000) return 'Too long';
  if (field.kind === 'select' && !(field.options ?? []).some((o) => o.value === v))
    return 'Not one of the choices';
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(v)) return 'Does not look right';
    } catch {
      /* a recipe with a bad pattern is rejected when it is saved */
    }
  }
  return null;
}

/**
 * Merges what an admin sent over what is stored and checks it against the recipe.
 *  - unknown fields are refused (a stray key is never stored);
 *  - `existing` keeps fields that were not sent; `clear` removes fields (a required field cannot be cleared);
 *  - every required field must be present after the merge.
 */
export function mergeCredentials(
  recipe: MarketRecipe | null,
  existing: Record<string, string>,
  sent: Record<string, string>,
  clear: readonly string[] = [],
): {
  values: Record<string, string>;
  hints: Record<string, string>;
  problems: CredentialProblem[];
} {
  const fields = new Map((recipe?.authFields ?? []).map((f) => [f.key, f]));
  const problems: CredentialProblem[] = [];
  const values: Record<string, string> = { ...existing };

  for (const [key, raw] of Object.entries(sent)) {
    const f = fields.get(key);
    if (!f) {
      problems.push({ path: `credentials.${key}`, message: 'This app has no such field' });
      continue;
    }
    const why = checkCredentialValue(f, raw);
    if (why) problems.push({ path: `credentials.${key}`, message: why });
    else values[key] = raw.trim();
  }
  for (const key of clear) {
    const f = fields.get(key);
    if (!f)
      problems.push({ path: `clearCredentials.${key}`, message: 'This app has no such field' });
    else if (f.required)
      problems.push({
        path: `clearCredentials.${key}`,
        message: 'A required field cannot be cleared',
      });
    else delete values[key];
  }
  for (const f of fields.values()) {
    if (f.required && values[f.key] === undefined) {
      problems.push({ path: `credentials.${f.key}`, message: 'Required' });
    }
  }
  // Anything stored for a field the recipe no longer has is dropped, so a version that removes a field also removes its secret.
  for (const key of Object.keys(values)) if (!fields.has(key)) delete values[key];

  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) hints[key] = hintFor(fields.get(key)!, value);
  return { values, hints, problems };
}

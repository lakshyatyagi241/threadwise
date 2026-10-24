/** Property types that take a number. The CRM reads a value into them with `Number(...)` (`coercePropertyValue`), so this does too. */
export const takesNumbers = (type: string | undefined): boolean =>
  type === 'integer' || type === 'decimal';

export type NumberWarning = { kind: 'untested' } | { kind: 'text'; value: string };

/**
 * What a mapping row that saves into a number property says before it is saved. `answer` is what its response path held in the last
 * test: undefined when no test has run yet, null when the path is not in the answer (then the default, or nothing, is written).
 * A text answer warns: it would be saved into a number field as it is.
 */
export function numberWarning(
  type: string | undefined,
  answer: string | null | undefined,
): NumberWarning | null {
  if (!takesNumbers(type)) return null;
  if (answer === undefined) return { kind: 'untested' };
  // A missing or blank answer writes nothing (or the default), so there is no text to warn about.
  if (answer === null || answer.trim() === '' || answer === 'null') return null;
  return Number.isFinite(Number(answer)) ? null : { kind: 'text', value: answer };
}

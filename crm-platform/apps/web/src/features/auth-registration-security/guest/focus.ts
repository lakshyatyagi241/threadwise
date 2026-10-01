/** Moves focus to the named control of a form ("focus the first invalid field after a failed submit"). */
export function focusField(form: HTMLFormElement | null, name: string | undefined): void {
  if (!form || !name) return;
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLElement) el.focus();
}

/** Focuses the first control in `order` that is in `invalid`. Returns the name that got focus. */
export function focusFirstInvalid(
  form: HTMLFormElement | null,
  order: readonly string[],
  invalid: ReadonlySet<string> | readonly string[],
): string | undefined {
  const set = new Set(invalid);
  const first = order.find((n) => set.has(n));
  focusField(form, first);
  return first;
}

/** A copy of `record` without `key` (editing a field clears that field's error). Returns the same object when nothing changes. */
export function dropKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!key || !(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

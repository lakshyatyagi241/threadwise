/**
 * The keyword and allowlist textareas hold one entry per line, but commas work
 * too (people paste either). Entries are trimmed and empties dropped; an empty
 * textarea means an empty list. Duplicates are kept: removing them silently is
 * a surprise, and the server accepts them.
 */
export function parseList(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const formatList = (items: readonly string[]): string => items.join('\n');

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Appends an entry unless the list already has it. Returns the new text. */
export function appendEntry(text: string, entry: string): string {
  const list = parseList(text);
  if (list.includes(entry)) return formatList(list);
  return formatList([...list, entry]);
}

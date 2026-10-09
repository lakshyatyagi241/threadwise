import { API_LIBRARY_PATH_RE } from '@crm/contracts';

/**
 * Response paths, as the API reads them: `data.items[0].name` is one element, `data.items[].name` every element collected into
 * a list. The response viewer builds them from the answer; a click on a value adds one to the flow variables or the mapping.
 */
export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return parent === '' ? key : `${parent}.${key}`;
}

/** `data.items[2].name` -> `data.items[].name`. */
export const allIndexPath = (path: string): string => path.replace(/\[\d+\]/g, '[]');

export const hasIndex = (path: string): boolean => /\[\d+\]/.test(path);

/** A key the path syntax can hold (no dots, brackets or spaces in it), so a click on it can be offered. */
export const isUsablePath = (path: string): boolean => API_LIBRARY_PATH_RE.test(path);

export interface TreeLeaf {
  path: string;
  value: string;
}

/** Every primitive in the answer with its path, depth-first, capped so a huge answer cannot freeze the page. */
export function leavesOf(json: unknown, limit = 500): TreeLeaf[] {
  const out: TreeLeaf[] = [];
  const walk = (v: unknown, path: string) => {
    if (out.length >= limit) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, childPath(path, i)));
    else if (v !== null && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        walk(x, childPath(path, k));
    else if (path !== '') out.push({ path, value: v === null ? 'null' : String(v) });
  };
  walk(json, '');
  return out;
}

/** Whether a path (exact or its all-index form) is already chosen. */
export function chosenPath(path: string, chosen: readonly string[]): string | null {
  const all = allIndexPath(path);
  return chosen.find((c) => c === path) ?? chosen.find((c) => c === all) ?? null;
}

export type PathUse = 'flow' | 'contact' | 'both';

/** The text to insert in a field for a chip: `{{name}}`. */
export const tokenText = (name: string): string => `{{${name}}}`;

/**
 * Backspace right after a `{{token}}` removes the whole token, as the old console's chips did. Returns the new text and caret, or
 * null when the caret is not right after a closing `}}` (the browser then deletes one character as usual).
 */
export function removeTokenBefore(
  text: string,
  caret: number,
): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  if (!before.endsWith('}}')) return null;
  const start = before.lastIndexOf('{{');
  if (start < 0) return null;
  const inner = before.slice(start + 2, -2);
  if (inner.includes('{') || inner.includes('}')) return null;
  return { text: text.slice(0, start) + text.slice(caret), caret: start };
}

/** Inserts a token at the caret (or replaces the selection). */
export function insertAt(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

import { SYSTEM_ATTRIBUTES } from '@crm/contracts';
import type { Translate } from '../../lib/msg';

/**
 * Pure logic behind the "type / to insert an attribute" popover every inspector text field carries (WaDesk's
 * attribute-picker: any field marked data-attr-input opens a list of the workspace's merge tokens when "/" starts a word).
 */

export interface AttrEntry {
  kind: 'system' | 'custom';
  key: string;
  name: string;
  description: string;
}

export interface SlashQuery {
  /** Index of the "/" that opened the picker. */
  start: number;
  /** What was typed after it (the filter). */
  query: string;
}

/** WaDesk gives up on a query longer than this: it is a real slash, not a picker request. */
export const SLASH_QUERY_MAX = 24;

/**
 * The open slash token at the caret, or null. The slash only counts when it starts a word (start of the text or after
 * whitespace); typing a space or a newline after it ends the token, and so does a query longer than 24 characters.
 */
export function findSlashQuery(text: string, caret: number): SlashQuery | null {
  const upTo = text.slice(0, caret);
  const start = upTo.lastIndexOf('/');
  if (start === -1) return null;
  const before = start === 0 ? '' : (upTo[start - 1] as string);
  if (before && !/\s/.test(before)) return null;
  const query = upTo.slice(start + 1);
  if (/\s/.test(query)) return null;
  if (query.length > SLASH_QUERY_MAX) return null;
  return { start, query };
}

/** Replaces the "/query" under the caret by the `{{key}}` token and returns the new text and caret. */
export function insertAttrToken(
  text: string,
  slashStart: number,
  selectionEnd: number,
  key: string,
): { text: string; caret: number } {
  const token = `{{${key}}}`;
  const before = text.slice(0, slashStart);
  return { text: before + token + text.slice(selectionEnd), caret: before.length + token.length };
}

/** Case-insensitive match on key, name or description; an empty query keeps everything. */
export function filterAttrs(entries: readonly AttrEntry[], query: string): AttrEntry[] {
  const q = query.toLowerCase();
  if (!q) return entries.slice();
  return entries.filter(
    (a) =>
      a.key.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
  );
}

const SYSTEM_KEYS: ReadonlySet<string> = new Set(SYSTEM_ATTRIBUTES.map((a) => a.key));

/**
 * The picker feed as entries; until the feed arrives (or if it fails) the built-in tokens are still offered. The built-in
 * tokens' names and descriptions come from the catalogue (`flb.builder.attrPicker.system.<key>`) when a translator is given;
 * the workspace's own attributes keep the names its users gave them.
 */
export function attrEntries(
  feed:
    | {
        system: ReadonlyArray<{ key: string; name: string; description: string }>;
        custom: ReadonlyArray<{ key: string; name: string; description: string | null }>;
      }
    | undefined,
  t?: Translate,
): AttrEntry[] {
  const system = feed?.system ?? SYSTEM_ATTRIBUTES;
  const known = (key: string) => t !== undefined && SYSTEM_KEYS.has(key);
  return [
    ...system.map((s) => ({
      kind: 'system' as const,
      key: s.key,
      name: known(s.key) ? t!(`builder.attrPicker.system.${s.key}.name`) : s.name,
      description: known(s.key)
        ? t!(`builder.attrPicker.system.${s.key}.description`)
        : s.description,
    })),
    ...(feed?.custom ?? []).map((c) => ({
      kind: 'custom' as const,
      key: c.key,
      name: c.name,
      description: c.description ?? '',
    })),
  ];
}

/** The next highlighted row for an arrow key (wraps around). */
export function stepActive(current: number, length: number, dir: -1 | 1): number {
  return length === 0 ? 0 : (current + dir + length) % length;
}

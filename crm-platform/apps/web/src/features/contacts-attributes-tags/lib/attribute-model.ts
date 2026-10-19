import { ATTRIBUTE_KEY_PATTERN, type AttributeResponse } from '@crm/contracts';

/**
 * Reference's "attribute": a named variable with a key, an optional default and a description. Here it is a row of the
 * contacts field registry served by `/v2/attributes`; a contact's value lives in its `customFields` under the key.
 * The key and type never change once created.
 */

export interface Attribute {
  id: string;
  name: string;
  key: string;
  defaultValue: string;
  description: string;
  active: boolean;
  /** Hidden in the property registry: kept, but not offered as a column, filter or input. */
  hidden: boolean;
  rowVersion: number;
}

export function toAttribute(a: AttributeResponse): Attribute {
  return {
    id: a.id,
    name: a.name,
    key: a.key,
    defaultValue: a.defaultValue ?? '',
    description: a.description ?? '',
    active: a.isActive,
    hidden: a.isHidden === true,
    rowVersion: a.rowVersion,
  };
}

/** The key rule (shared with the API): lower-case snake_case starting with a letter, at most 64 characters. */
export const ATTRIBUTE_KEY = ATTRIBUTE_KEY_PATTERN;
export const ATTRIBUTE_KEY_MAX = 64;

export type AttributeKeyProblem = 'required' | 'format' | 'tooLong';

export function checkAttributeKey(key: string): AttributeKeyProblem | null {
  const k = key.trim();
  if (!k) return 'required';
  if (k.length > ATTRIBUTE_KEY_MAX) return 'tooLong';
  return ATTRIBUTE_KEY.test(k) ? null : 'format';
}

/** "Order ID" -> "order_id": the suggestion offered while the name is typed and the key has not been touched. */
export function suggestKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, ATTRIBUTE_KEY_MAX);
}

/** Status filter of the attributes screen; the server applies it (and the search) and returns the counts. */
export type StatusFilter = 'all' | 'active' | 'inactive';

export interface PickerEntry {
  kind: 'system' | 'custom';
  key: string;
  name: string;
  description: string;
}

/** Narrows the picker's feed (system tokens, then active custom attributes) by key, name or description. */
export function filterPicker(feed: readonly PickerEntry[], query: string): PickerEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...feed];
  return feed.filter((e) => `${e.key} ${e.name} ${e.description}`.toLowerCase().includes(q));
}

/**
 * The slash query at the caret, if one is open: a "/" that starts a token (start of text or after whitespace),
 * followed by at most 24 characters without whitespace (TW-CON-046).
 */
export function findSlashQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const slash = before.lastIndexOf('/');
  if (slash < 0) return null;
  if (slash > 0 && !/\s/.test(before[slash - 1]!)) return null;
  const query = before.slice(slash + 1);
  if (/\s/.test(query) || query.length > 24) return null;
  return { start: slash, query };
}

/** Replaces the "/query" with the named token `{{key}}` and reports where the caret goes. */
export function insertToken(
  text: string,
  caret: number,
  start: number,
  key: string,
): { text: string; caret: number } {
  const token = `{{${key}}}`;
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length };
}

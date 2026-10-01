import { MERGE_TAG_PATTERN } from '@crm/contracts';
import { flattenMap } from './payload/template-vars';

/**
 * Team-inbox mirroring of broadcast sends (TW-BCAST-028): what the bubble says and what identifies it. Pure.
 */

/** Statuses that may create the bubble: any of them, so a lost `sent` report heals on `delivered` or `read`. */
export const MIRROR_STATUSES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read']);

/** The preview on the conversation row is the first 200 characters of the bubble. */
export const PREVIEW_LENGTH = 200;

export const digitsOf = (phone: string | null | undefined): string =>
  (phone ?? '').replace(/\D+/g, '');

/** Header, body and footer as the customer read them, one blank line apart; empty parts are left out. */
export function readableTemplateBody(t: {
  header: string | null;
  templateBody: string;
  footer: string | null;
}): string {
  return [t.header, t.templateBody, t.footer]
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join('\n\n');
}

const NAME_KEYS = new Set(['name', 'first_name', 'full_name']);

/**
 * Fills `{{1}}` / `{{name}}` with this recipient's values, the way the send did. A blank name slot reads "there" (so the bubble
 * says "Hi there," like the message the customer got), any other blank slot is empty, runs of spaces collapse. A token the
 * variable map does not know is looked up as written.
 */
export function resolveBodyTokens(
  text: string,
  variableMap: unknown,
  pull: (key: string) => string,
): string {
  const slots = flattenMap(variableMap);
  const filled = text.replace(MERGE_TAG_PATTERN, (_m, inner: string) => {
    const slot = inner.trim();
    const key = slots[slot] ?? slot;
    const value = pull(key);
    if (value !== '') return value;
    return NAME_KEYS.has(key.trim().toLowerCase().replace(/\s+/g, '_')) ? 'there' : '';
  });
  return filled.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Deterministic per (broadcast, contact): whichever report arrives first wins, whatever it carries. */
export const srcKey = (broadcastId: number, contactId: number): string =>
  `broadcast:${broadcastId}:contact:${contactId}`;

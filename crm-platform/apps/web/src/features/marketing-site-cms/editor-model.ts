import type { CmsEntry, CmsField } from '@crm/contracts';

/**
 * What the editor shows for a field: the stored draft, else the published value, else the shipped default.
 * An empty string means "use the default" (the same rule the API applies on publish).
 */
export function effectiveValue(
  entry: Pick<CmsEntry, 'draft' | 'published'> | undefined,
  field: Pick<CmsField, 'default'>,
): string {
  const v = entry?.draft ?? entry?.published ?? null;
  return v === null || v === '' ? field.default : v;
}

/** A stored row whose draft differs from what is live. */
export const hasPendingDraft = (
  entry: Pick<CmsEntry, 'draft' | 'published'> | undefined,
): boolean => !!entry && entry.draft !== null && entry.draft !== entry.published;

export interface DraftWrite {
  key: string;
  value: string;
  rowVersion?: number;
}

/** The drafts to send: only known keys whose edited value differs from what the editor loaded. */
export function dirtyDrafts(
  edits: Readonly<Record<string, string>>,
  entries: ReadonlyMap<string, CmsEntry>,
  fields: ReadonlyMap<string, CmsField>,
): DraftWrite[] {
  const out: DraftWrite[] = [];
  for (const [key, value] of Object.entries(edits)) {
    const field = fields.get(key);
    const entry = entries.get(key);
    if (!field || value === effectiveValue(entry, field)) continue;
    out.push(entry ? { key, value, rowVersion: entry.rowVersion } : { key, value });
  }
  return out;
}

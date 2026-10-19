import {
  retentionDeleteAfterDays,
  retentionProblem,
  type RetentionItemView,
  type RetentionProblem,
  type RetentionValues,
} from '@crm/contracts';

/** What the form holds while it is being edited: the raw text of the two numbers and the "for ever" switch. */
export interface ItemDraft {
  liveDays: string;
  keepForever: boolean;
  archiveDays: string;
}

export type DraftProblem = RetentionProblem | 'not_a_number';

const WHOLE = /^\d{1,5}$/;

/**
 * The form for an item as it stands. An item that follows a "keep for ever" security policy has no live number to show, so the
 * field starts at the smallest allowed one rather than at 0 (which the API would refuse).
 */
export function draftFromItem(item: RetentionItemView): ItemDraft {
  const live = item.liveDays >= item.limits.live.min ? item.liveDays : item.limits.live.min;
  return {
    liveDays: String(live),
    keepForever: item.archiveDays === null,
    archiveDays: String(item.archiveDays ?? item.limits.archive.min),
  };
}

/** The values the draft stands for, or the first thing wrong with it. */
export function valuesOf(
  item: RetentionItemView,
  draft: ItemDraft,
): { values: RetentionValues } | { problem: DraftProblem } {
  if (!WHOLE.test(draft.liveDays.trim())) return { problem: 'not_a_number' };
  const liveDays = Number(draft.liveDays.trim());
  let archiveDays: number | null = null;
  if (item.canArchive && !draft.keepForever) {
    if (!WHOLE.test(draft.archiveDays.trim())) return { problem: 'not_a_number' };
    archiveDays = Number(draft.archiveDays.trim());
  }
  const values = { liveDays, archiveDays };
  const problem = retentionProblem(item.id, values);
  return problem ? { problem } : { values };
}

/** True when saving would change something: a default item counts as changed once it is saved for the first time. */
export function isChanged(item: RetentionItemView, draft: ItemDraft): boolean {
  const r = valuesOf(item, draft);
  if (!('values' in r)) return true;
  if (item.source === 'default') return true;
  return r.values.liveDays !== item.liveDays || r.values.archiveDays !== item.archiveDays;
}

export interface Summary {
  kind: 'noArchive' | 'archiveForever' | 'archiveThenDelete';
  live: number;
  archive: number | null;
  total: number | null;
}

/** The one sentence under the form: when the data leaves the database and when it is deleted for good. */
export function summaryOf(item: RetentionItemView, values: RetentionValues): Summary {
  const total = retentionDeleteAfterDays(values);
  if (!item.canArchive)
    return { kind: 'noArchive', live: values.liveDays, archive: null, total: values.liveDays };
  if (values.archiveDays === null) {
    return { kind: 'archiveForever', live: values.liveDays, archive: null, total: null };
  }
  return { kind: 'archiveThenDelete', live: values.liveDays, archive: values.archiveDays, total };
}

/** Whether saving would delete or archive data that exists today, so the person must see what and confirm. */
export function hasImpact(p: {
  toArchive: readonly unknown[];
  toDeleteFromArchive: readonly unknown[];
  rowsToDelete: number | null;
  rowsToArchive?: number | null | undefined;
}): boolean {
  return (
    p.toArchive.length > 0 ||
    p.toDeleteFromArchive.length > 0 ||
    (p.rowsToDelete ?? 0) > 0 ||
    (p.rowsToArchive ?? 0) > 0
  );
}

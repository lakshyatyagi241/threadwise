import type { AuditLogEntry } from '@crm/contracts';

/**
 * Whether a loaded audit entry matches the search typed on a module's activity panel: who did it, the action (by its stored name and
 * its translated word) and the names of the fields that changed. Values are never searched: the log does not carry them. Pure.
 */
export function matchesActivity(
  entry: Pick<AuditLogEntry, 'actor' | 'action' | 'changedFields'>,
  query: string,
  actionWord: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  const haystack = [entry.actor.name ?? '', entry.action, actionWord, ...entry.changedFields]
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

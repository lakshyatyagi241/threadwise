import type { ConversationStatus } from '@crm/contracts';
import type { BulkKind } from './bulk-bar';

/** What the bar needs to know about each chosen conversation. */
export interface BulkRowFacts {
  status: ConversationStatus;
  unreadCount: number;
}

/** The base actions in the order the bar lists them; one may be swapped for its undo (or dropped) by what is chosen. */
const ORDER = ['read', 'status', 'assign', 'label', 'priority', 'snooze', 'spam'] as const;

/**
 * The actions the bar offers for these chosen conversations, in order. The bar follows what is chosen, so an action can be undone
 * the way it was done (the same way the single conversation's header does):
 * - every chosen one is snoozed: **Unsnooze** replaces Snooze (status Open wakes a snoozed conversation);
 * - every chosen one is spam: **Not spam** replaces Mark as spam, and Status goes (Not spam is its only way out);
 * - every chosen one is resolved or closed: **Reopen** replaces Status;
 * - none has anything unread: Mark as read goes (there is no bulk "mark as unread" on the server).
 * Whatever is mixed keeps the plain action, and `allowed` (the person's rights) still decides what may show at all.
 */
export function bulkKindsFor(
  rows: readonly BulkRowFacts[],
  allowed: readonly BulkKind[],
): BulkKind[] {
  const known = rows.length > 0;
  const every = (test: (row: BulkRowFacts) => boolean) => known && rows.every(test);
  const allSnoozed = every((r) => r.status === 'snoozed');
  const allSpam = every((r) => r.status === 'spam');
  const allDone = every((r) => r.status === 'resolved' || r.status === 'closed');
  const noneUnread = every((r) => r.unreadCount === 0);

  const kinds: BulkKind[] = [];
  for (const base of ORDER) {
    let kind: BulkKind | null = base;
    if (base === 'read' && noneUnread) kind = null;
    else if (base === 'status') kind = allSpam ? null : allDone ? 'reopen' : 'status';
    else if (base === 'snooze') kind = allSpam ? null : allSnoozed ? 'unsnooze' : 'snooze';
    else if (base === 'spam') kind = allSpam ? 'notSpam' : 'spam';
    if (kind && allowed.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** The one status every chosen conversation already has, or null when they differ: the Status sheet does not offer it again. */
export function commonStatus(rows: readonly BulkRowFacts[]): ConversationStatus | null {
  const first = rows[0]?.status;
  return first && rows.every((r) => r.status === first) ? first : null;
}

import type { RecordScope } from '@crm/contracts';
import { conversationScopeAllows } from '../../kernel/rbac/scope';

/** The permission that decides who may see a conversation. */
export const PERM_CONVERSATION_READ = 'inbox.conversation.read';
/** The permission that lets a team- or own-scoped viewer also see conversations assigned to nobody (decision D2). */
export const PERM_CONVERSATION_READ_UNASSIGNED = 'inbox.conversation.read_unassigned';

/**
 * What visibility depends on: who the conversation is assigned to and who owns the channel it arrived on.
 *
 * `channelOwnerUserId` is REQUIRED on purpose (TW-MAIL-035): a caller that builds a record by hand cannot forget it, the compiler
 * says so. `null` = the channel is shared (every channel but a personal mailbox). A number = a personal mailbox's owner. `PERSONAL_OWNER_GONE`
 * (-1) = an email channel whose mailbox row no longer exists (its owner was removed): nobody is the owner, so only the admin
 * reading right (below) can open it, which fails closed instead of turning a private mailbox into a shared one.
 */
export interface ConversationRecord {
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  channelOwnerUserId: number | null;
}

/**
 * Whether a viewer built for `permission` sees unassigned conversations (decision D2).
 *
 * For the READ permission that is the new permission `inbox.conversation.read_unassigned` (`holdsUnassigned`). For every other
 * permission (reply, note, assign, resolve, ...: "may I act on this one") the question is only asked after the conversation is known to
 * be visible, so the rule stays what it always was: a team-scoped grant covers the unassigned queue, an own-scoped one does not.
 * Keeping that here (and not granting the new permission to roles by their reply scope) means no acting right changes either.
 */
export function viewerReadsUnassigned(
  permission: string,
  scope: RecordScope | null,
  holdsUnassigned: boolean,
): boolean {
  if (permission === PERM_CONVERSATION_READ) return holdsUnassigned;
  return scope === 'team' || scope === 'team_and_below';
}

/** The `channelOwnerUserId` of an email channel whose personal mailbox row is gone. Matches no user id. */
export const PERSONAL_OWNER_GONE = -1;

/**
 * One staff user as visibility sees them: their read scope (null when they hold no allow grant), their teams (for `team_and_below` also
 * every team below them) and whether they hold `inbox.conversation.read_unassigned` (BL-382, decision D2).
 */
export interface ConversationViewer {
  userId: number;
  scope: RecordScope | null;
  teamIds: readonly number[];
  readsUnassigned: boolean;
  /**
   * True only for an admin (holds `mail.settings.manage`) of a workspace whose policy says `admins_can_read_personal`: they may open other
   * people's personal-mailbox conversations (still inside their own read scope). Absent / false = a personal mailbox is its owner's alone.
   */
  readsPersonalMail?: boolean;
}

/**
 * Whether a staff user may see a conversation (plan 3.7), the single rule behind both the REST read and every realtime
 * delivery, so the list, the thread and the socket can never disagree:
 *
 *   all             every conversation, assigned or not
 *   team            the ones assigned to me or to one of my teams
 *   team_and_below  the same, with the teams below mine
 *   own             only the ones assigned to me
 *
 * plus, for `team` and `team_and_below`, the unassigned ones when the viewer holds `inbox.conversation.read_unassigned`.
 *
 * A conversation on a PERSONAL mailbox's channel (TW-MAIL-035) is first filtered by who owns the channel:
 *
 *   the owner         sees all of it, whatever their assignment scope (it is their own mail), provided they may read conversations at all
 *   an admin          only when the workspace policy lets admins read personal mailboxes (`readsPersonalMail`), then by their scope as usual
 *   everyone else     nothing, not even its existence
 *
 * `visibleToSql` (team-inbox-conversations/visibility-sql.ts) is the same rule as a SQL condition; the two are kept in step by a test.
 *
 * No grant (or a deny) sees nothing. Reference authorised every member of the workspace for every conversation's channel; here a
 * conversation reaches a person only if this says so.
 */
export function conversationVisible(
  viewer: ConversationViewer,
  record: ConversationRecord,
): boolean {
  if (viewer.scope === null) return false;
  if (record.channelOwnerUserId !== null) {
    if (record.channelOwnerUserId === viewer.userId) return true;
    if (viewer.readsPersonalMail !== true) return false;
  }
  // The assignment rule lives with the other scope rules (kernel/rbac/scope, 'conversation' mode).
  return conversationScopeAllows(viewer, record);
}

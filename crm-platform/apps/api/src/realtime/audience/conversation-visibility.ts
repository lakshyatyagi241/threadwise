import type { RecordScope } from '@crm/contracts';
import { conversationScopeAllows } from '../../kernel/rbac/scope';

/** The permission that decides who may see a conversation. */
export const PERM_CONVERSATION_READ = 'inbox.conversation.read';

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

/** The `channelOwnerUserId` of an email channel whose personal mailbox row is gone. Matches no user id. */
export const PERSONAL_OWNER_GONE = -1;

/** One staff user as visibility sees them: their read scope (null when they hold no allow grant) and their teams. */
export interface ConversationViewer {
  userId: number;
  scope: RecordScope | null;
  teamIds: readonly number[];
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
 *   all   every conversation, assigned or not
 *   team  the ones assigned to me or to one of my teams, and the unassigned ones
 *   own   only the ones assigned to me
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

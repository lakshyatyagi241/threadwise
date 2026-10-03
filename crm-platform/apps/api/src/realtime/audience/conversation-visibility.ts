import type { RecordScope } from '@crm/contracts';

/** The permission that decides who may see a conversation. */
export const PERM_CONVERSATION_READ = 'inbox.conversation.read';

/** What visibility depends on: who the conversation is assigned to, nothing else. */
export interface ConversationRecord {
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
}

/** One staff user as visibility sees them: their read scope (null when they hold no allow grant) and their teams. */
export interface ConversationViewer {
  userId: number;
  scope: RecordScope | null;
  teamIds: readonly number[];
}

/**
 * Whether a staff user may see a conversation (plan 3.7), the single rule behind both the REST read and every realtime
 * delivery, so the list, the thread and the socket can never disagree:
 *
 *   all   every conversation, assigned or not
 *   team  the ones assigned to me or to one of my teams, and the unassigned ones
 *   own   only the ones assigned to me
 *
 * No grant (or a deny) sees nothing. Reference authorised every member of the workspace for every conversation's channel; here a
 * conversation reaches a person only if this says so.
 */
export function conversationVisible(
  viewer: ConversationViewer,
  record: ConversationRecord,
): boolean {
  switch (viewer.scope) {
    case null:
      return false;
    case 'all':
      return true;
    case 'team':
      if (record.assigneeUserId === viewer.userId) return true;
      if (record.assigneeTeamId !== null && viewer.teamIds.includes(record.assigneeTeamId))
        return true;
      return record.assigneeUserId === null && record.assigneeTeamId === null;
    case 'own':
      return record.assigneeUserId === viewer.userId;
  }
}

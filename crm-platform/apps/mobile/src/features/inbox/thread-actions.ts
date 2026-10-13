import {
  canMoveConversationStatus,
  type ConversationAssignment,
  type ConversationStatus,
} from '@crm/contracts';

/** What the three dots of a thread can offer, besides the resolve / reopen button beside them. */
export type MenuAction = 'assignToMe' | 'unassign' | 'pending' | 'close';

/** The conversation is being answered by an AI agent and no person has it. */
export const isBotConversation = (assignment: ConversationAssignment): boolean =>
  assignment.aiAgent !== null && assignment.user === null;

interface Input {
  status: ConversationStatus;
  assignment: ConversationAssignment;
  /** The signed-in person's id, to tell "mine" from "someone else's". */
  meId: string;
  /** `inbox.conversation.assign`: may give a conversation to anyone, or take it from them. */
  canAssign: boolean;
  /** `inbox.conversation.assign_self`: may only claim it for themselves. */
  canAssignSelf: boolean;
  /** `inbox.conversation.resolve`: may move the conversation between statuses. */
  canResolve: boolean;
}

/** The actions that make sense for this conversation and this person, in the order the menu lists them. */
export function menuActionsFor(input: Input): MenuAction[] {
  const { status, assignment, meId, canAssign, canAssignSelf, canResolve } = input;
  const actions: MenuAction[] = [];
  if ((canAssign || canAssignSelf) && assignment.user?.id !== meId) actions.push('assignToMe');
  if (canAssign && assignment.user !== null) actions.push('unassign');
  // The contract counts "to the status it already has" as a legal move; a menu line that changes nothing is not offered.
  const moveTo = (to: ConversationStatus) => status !== to && canMoveConversationStatus(status, to);
  if (canResolve && moveTo('pending')) actions.push('pending');
  if (canResolve && moveTo('closed')) actions.push('close');
  return actions;
}

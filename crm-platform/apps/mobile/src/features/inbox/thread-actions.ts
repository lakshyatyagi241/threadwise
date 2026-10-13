import {
  canMoveConversationStatus,
  type ConversationAssignment,
  type ConversationStatus,
} from '@crm/contracts';

/** What the three dots of a thread can offer, besides the resolve / reopen button beside them. */
export type MenuAction =
  'assignToMe' | 'changeAgent' | 'unassign' | 'priority' | 'snooze' | 'wake' | 'pending' | 'close';

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
  /** `inbox.conversation.priority`: may change how urgent the conversation is. */
  canPriority?: boolean;
  /** `inbox.conversation.snooze`: may park the conversation until a time. */
  canSnooze?: boolean;
}

/** The actions that make sense for this conversation and this person, in the order the menu lists them. */
export function menuActionsFor(input: Input): MenuAction[] {
  const { status, assignment, meId, canAssign, canAssignSelf, canResolve } = input;
  const actions: MenuAction[] = [];
  if ((canAssign || canAssignSelf) && assignment.user?.id !== meId) actions.push('assignToMe');
  // Handing it to anyone (not only claiming it) is the right to assign; so is taking it away from them.
  if (canAssign) actions.push('changeAgent');
  if (canAssign && assignment.user !== null) actions.push('unassign');
  if (input.canPriority) actions.push('priority');
  // Only a live thread can be parked (the API refuses the others); a parked one is woken by moving it to open.
  if (input.canSnooze && (status === 'open' || status === 'pending')) actions.push('snooze');
  if (canResolve && status === 'snoozed') actions.push('wake');
  // The contract counts "to the status it already has" as a legal move; a menu line that changes nothing is not offered.
  const moveTo = (to: ConversationStatus) => status !== to && canMoveConversationStatus(status, to);
  if (canResolve && moveTo('pending')) actions.push('pending');
  if (canResolve && moveTo('closed')) actions.push('close');
  return actions;
}

/** How long a snooze lasts, as the sheet offers it. */
export const SNOOZE_CHOICES = ['hour', 'threeHours', 'tomorrow', 'nextWeek'] as const;
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number];

/** The morning hour "tomorrow" and "next week" wake the conversation at (the person's own clock). */
const WAKE_HOUR = 9;

/**
 * When a snooze choice ends, as the ISO time the API takes (it must be at least a minute ahead): an hour, three hours, nine in the
 * morning tomorrow, or nine in the morning next Monday. `now` is passed in so the answer is a function of it alone.
 */
export function snoozeUntil(choice: SnoozeChoice, now: Date): string {
  const at = new Date(now);
  switch (choice) {
    case 'hour':
      at.setHours(at.getHours() + 1);
      break;
    case 'threeHours':
      at.setHours(at.getHours() + 3);
      break;
    case 'tomorrow':
      at.setDate(at.getDate() + 1);
      at.setHours(WAKE_HOUR, 0, 0, 0);
      break;
    case 'nextWeek': {
      // The next Monday after today (a Monday asks for the one after it).
      const days = (8 - at.getDay()) % 7 || 7;
      at.setDate(at.getDate() + days);
      at.setHours(WAKE_HOUR, 0, 0, 0);
      break;
    }
  }
  return at.toISOString();
}

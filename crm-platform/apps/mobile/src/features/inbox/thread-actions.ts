import {
  canMoveConversationStatus,
  type ConversationAssignment,
  type ConversationStatus,
} from '@crm/contracts';

/** What the three dots of a thread offer, as in the reference app: the details, and the three sheets (status, labels, agent). */
export type MenuAction = 'details' | 'status' | 'labels' | 'agent';

/** The statuses a person can move a conversation to by hand (`snoozed` and `spam` have their own routes). */
export const STATUS_TARGETS = ['open', 'pending', 'resolved', 'closed'] as const;

/** The conversation is being answered by an AI agent and no person has it. */
export const isBotConversation = (assignment: ConversationAssignment): boolean =>
  assignment.aiAgent !== null && assignment.user === null;

interface Input {
  status: ConversationStatus;
  /** `inbox.conversation.resolve`: may move the conversation between statuses. */
  canResolve: boolean;
  /** `inbox.conversation.tag`: may put labels on the conversation. */
  canLabel: boolean;
  /** `inbox.conversation.assign`: may hand the conversation to anyone, or take it from them. */
  canAssign: boolean;
}

/**
 * The lines of the three dots for this conversation and this person, in the order the reference app lists them: View details
 * (always), Change status (when another status is reachable), Assign labels, Assign agent. Priority, snooze and waking a snoozed
 * conversation are on the details screen.
 */
export function menuActionsFor(input: Input): MenuAction[] {
  const { status, canResolve, canLabel, canAssign } = input;
  const actions: MenuAction[] = ['details'];
  // The contract counts "to the status it already has" as a legal move; a menu line that changes nothing is not offered.
  const moves = STATUS_TARGETS.some((to) => to !== status && canMoveConversationStatus(status, to));
  if (canResolve && moves) actions.push('status');
  if (canLabel) actions.push('labels');
  if (canAssign) actions.push('agent');
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

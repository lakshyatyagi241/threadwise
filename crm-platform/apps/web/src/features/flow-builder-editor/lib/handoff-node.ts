import { HANDOFF_REASONS } from '@crm/contracts';

/**
 * The Human handoff node (BL-398), on the `assign` node type. A node saved with `handoff: 2` runs the handoff service (a reason, a
 * priority, an internal note, the customer message, three exits); a node saved before it is the old Assign agent and keeps running as
 * it did, until the author clicks "Use handoff features" (never silently).
 */

type Bag = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const HANDOFF_VERSION = 2;
export const HANDOFF_REASON_CHOICES = HANDOFF_REASONS;
/** Empty = the conversation keeps the priority it has. */
export const HANDOFF_PRIORITY_CHOICES = ['', 'low', 'normal', 'high', 'urgent'] as const;
export const HANDOFF_MESSAGE_MAX = 1000;
export const HANDOFF_NOTE_MAX = 500;

export type HandoffDestinationKind = 'team' | 'person' | 'rules';
export const HANDOFF_DESTINATIONS: readonly HandoffDestinationKind[] = ['team', 'person', 'rules'];

/** Whether the node was saved as the Human handoff (else it is the old Assign agent). */
export const isHandoffNode = (d: Bag): boolean => d.handoff === HANDOFF_VERSION;

export function destinationOf(d: Bag): HandoffDestinationKind {
  const k = str(d.destination);
  return k === 'person' ? 'person' : k === 'rules' ? 'rules' : 'team';
}

/**
 * The data an old Assign agent node becomes when the author opts in: what it named stays (a person when one was picked, else the
 * team), its note stays the note for the agent, and the new fields start empty.
 */
export function upgradeLegacy(d: Bag): Bag {
  return {
    handoff: HANDOFF_VERSION,
    destination: str(d.userId) ? 'person' : 'team',
    team: str(d.team),
    userId: str(d.userId),
    reason: 'customer_asked',
    priority: '',
    message: str(d.message),
    summary: '',
    customerMessage: '',
    offHoursMessage: '',
  };
}

/** Every member of every team, once, for the "A person" destination. */
export function peopleOf(
  teams: readonly { members: readonly { id: string; name: string }[] }[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const t of teams) for (const m of t.members) if (!seen.has(m.id)) seen.set(m.id, m.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** What a Human handoff node still needs before the flow can be published: `null` when it is complete. */
export function handoffProblem(d: Bag): 'chooseTeam' | 'choosePerson' | null {
  if (!isHandoffNode(d)) return str(d.team).trim() ? null : 'chooseTeam';
  const kind = destinationOf(d);
  if (kind === 'team') return str(d.team).trim() ? null : 'chooseTeam';
  if (kind === 'person') return str(d.userId).trim() ? null : 'choosePerson';
  return null;
}

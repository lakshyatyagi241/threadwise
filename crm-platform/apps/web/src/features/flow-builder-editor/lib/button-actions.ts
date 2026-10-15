/**
 * "Button pressed action" on a Quick replies button. A button leads to the next step by its exit; it can also do something first:
 * hand the customer to a person, start another flow, or opt the contact in or out of marketing. The choice is kept per button
 * position in the node's data: `handoffs[i]` (live agent, existing) and `optionActions[i]` (the rest), never both for one button.
 */
export type ButtonActionKind = 'none' | 'flow' | 'live_agent' | 'opt_in' | 'opt_out';

export const BUTTON_ACTION_KINDS: readonly ButtonActionKind[] = [
  'none',
  'flow',
  'live_agent',
  'opt_in',
  'opt_out',
];

export type ButtonAction =
  | { kind: 'none' }
  | { kind: 'flow'; flow: string }
  | { kind: 'live_agent'; team: string; message: string }
  | { kind: 'opt_in' }
  | { kind: 'opt_out' };

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What button `i` of a node's data does when tapped. */
export function buttonActionOf(data: Record<string, unknown>, i: number): ButtonAction {
  const key = String(i);
  const handoff = rec(data.handoffs)[key];
  if (handoff !== undefined) {
    const h = rec(handoff);
    return { kind: 'live_agent', team: str(h.team), message: str(h.message) };
  }
  const a = rec(rec(data.optionActions)[key]);
  if (a.type === 'flow') return { kind: 'flow', flow: str(a.flow) };
  if (a.type === 'opt_in') return { kind: 'opt_in' };
  if (a.type === 'opt_out') return { kind: 'opt_out' };
  return { kind: 'none' };
}

/** The data keys to write so that button `i` does `action` (and nothing else). */
export function buttonActionPatch(
  data: Record<string, unknown>,
  i: number,
  action: ButtonAction,
): { handoffs: Record<string, unknown>; optionActions: Record<string, unknown> } {
  const key = String(i);
  const handoffs = { ...rec(data.handoffs) };
  const optionActions = { ...rec(data.optionActions) };
  delete handoffs[key];
  delete optionActions[key];
  if (action.kind === 'live_agent') handoffs[key] = { team: action.team, message: action.message };
  else if (action.kind === 'flow') optionActions[key] = { type: 'flow', flow: action.flow };
  else if (action.kind === 'opt_in' || action.kind === 'opt_out')
    optionActions[key] = { type: action.kind };
  return { handoffs, optionActions };
}

/** The same keys after button `removed` is deleted: its entry goes, the ones after it move up by one. */
export function buttonActionsWithout(
  data: Record<string, unknown>,
  removed: number,
): { handoffs: Record<string, unknown>; optionActions: Record<string, unknown> } {
  const shift = (v: unknown) =>
    Object.fromEntries(
      Object.entries(rec(v))
        .filter(([k]) => Number(k) !== removed)
        .map(([k, x]) => [String(Number(k) > removed ? Number(k) - 1 : Number(k)), x]),
    );
  return { handoffs: shift(data.handoffs), optionActions: shift(data.optionActions) };
}

/** True when the action still needs something before the flow can be published (a flow to start, a team to hand to). */
export function buttonActionIncomplete(a: ButtonAction): boolean {
  if (a.kind === 'flow') return a.flow.trim() === '';
  if (a.kind === 'live_agent') return a.team.trim() === '';
  return false;
}

/**
 * An action that carries on to the wired next step afterwards. A live-agent hand-over ends the bot's part, and a connected flow takes the
 * conversation over for good (the run does not come back), so nothing is wired after either.
 */
export const buttonActionContinues = (a: ButtonAction): boolean =>
  a.kind !== 'live_agent' && a.kind !== 'flow';

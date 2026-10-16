import {
  PREVIOUS_SENDS_MAX,
  PREVIOUS_SEND_OUTCOMES,
  previousOutcomeAllowed,
  type PreviousSendOption,
  type PreviousSendOutcome,
  type PreviousSendRef,
  type PreviousSendsAudience,
} from '@crm/contracts';

/** What the "Previous sends" source decides without the network (wizard step 2, the classic builder and the picker). Pure. */

export const EMPTY_PREVIOUS: PreviousSendsAudience = { sends: [], outcome: 'all' };

export const sendKey = (r: PreviousSendRef): string => `${r.kind}:${r.id}`;

/** The source as a form holds it: never null, so the picker always has something to show. */
export const previousOrEmpty = (
  p: PreviousSendsAudience | null | undefined,
): PreviousSendsAudience => p ?? EMPTY_PREVIOUS;

/** Whether any send is picked. */
export const hasPrevious = (p: PreviousSendsAudience | null | undefined): boolean =>
  (p?.sends.length ?? 0) > 0;

/** How many people the outcome holds for one send; null when that send does not record it (a broadcast keeps no replies or clicks). */
export function outcomeCount(o: PreviousSendOption, outcome: PreviousSendOutcome): number | null {
  const left = (n: number) => Math.max(0, n);
  switch (outcome) {
    case 'all':
      return o.recipients;
    case 'delivered':
      return o.delivered;
    case 'read':
      return o.read;
    case 'failed':
      return o.failed;
    case 'not_read':
      return left(o.recipients - o.failed - o.read);
    case 'replied':
      return o.replied;
    case 'not_replied':
      return o.replied === null ? null : left(o.recipients - o.failed - o.replied);
    case 'clicked':
      return o.clicked;
  }
}

/** Whether a ticked broadcast rules this outcome out (it keeps no replies or clicks). */
export const outcomeBlocked = (
  sends: readonly PreviousSendRef[],
  outcome: PreviousSendOutcome,
): boolean => sends.some((s) => !previousOutcomeAllowed(s.kind, outcome));

/** The outcome changed, or the same source when a ticked broadcast cannot give it. */
export function withOutcome(
  p: PreviousSendsAudience,
  outcome: PreviousSendOutcome,
): PreviousSendsAudience {
  return outcomeBlocked(p.sends, outcome) ? p : { ...p, outcome };
}

export type ToggleRefusal = 'limit' | 'outcome';

/** Whether this send can be ticked now, and if not why: 20 are ticked already, or it is a broadcast and the outcome needs replies or clicks. */
export function tickRefusal(p: PreviousSendsAudience, ref: PreviousSendRef): ToggleRefusal | null {
  if (p.sends.some((s) => sendKey(s) === sendKey(ref))) return null;
  if (p.sends.length >= PREVIOUS_SENDS_MAX) return 'limit';
  if (!previousOutcomeAllowed(ref.kind, p.outcome)) return 'outcome';
  return null;
}

/** The send ticked, or un-ticked when it was; the same source when it cannot be ticked. */
export function toggleSend(p: PreviousSendsAudience, ref: PreviousSendRef): PreviousSendsAudience {
  const key = sendKey(ref);
  if (p.sends.some((s) => sendKey(s) === key))
    return { ...p, sends: p.sends.filter((s) => sendKey(s) !== key) };
  return tickRefusal(p, ref) ? p : { ...p, sends: [...p.sends, { kind: ref.kind, id: ref.id }] };
}

/**
 * The source as the server will accept it: no repeats, at most 20 sends, a known outcome, and (for an outcome a ticked broadcast
 * cannot give) back to "everyone". Null stays null.
 */
export function sanitizePrevious(
  p: PreviousSendsAudience | null | undefined,
): PreviousSendsAudience | null | undefined {
  if (!p) return p;
  const seen = new Set<string>();
  const sends: PreviousSendRef[] = [];
  for (const s of p.sends) {
    const key = sendKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    sends.push({ kind: s.kind, id: s.id });
  }
  const known = (PREVIOUS_SEND_OUTCOMES as readonly string[]).includes(p.outcome);
  const outcome: PreviousSendOutcome = known ? p.outcome : 'all';
  const limited = sends.slice(0, PREVIOUS_SENDS_MAX);
  return { sends: limited, outcome: outcomeBlocked(limited, outcome) ? 'all' : outcome };
}

/**
 * The people the picked sends held for the chosen outcome, added up: an estimate (a contact who was in two sends is counted twice;
 * the server counts each once). Sends no longer in the list count for nothing.
 */
export function previousEstimate(
  p: PreviousSendsAudience | null | undefined,
  options: readonly PreviousSendOption[],
): number {
  if (!p) return 0;
  return p.sends.reduce((n, ref) => {
    const hit = options.find((o) => o.kind === ref.kind && o.id === ref.id);
    return n + (hit ? (outcomeCount(hit, p.outcome) ?? 0) : 0);
  }, 0);
}

/** The picked sends by name; one that is gone from the list keeps its place and is flagged. */
export function previousNames(
  p: PreviousSendsAudience | null | undefined,
  options: readonly PreviousSendOption[] | undefined,
): Array<{ key: string; name: string; found: boolean }> {
  return (p?.sends ?? []).map((ref) => {
    const hit = options?.find((o) => o.kind === ref.kind && o.id === ref.id);
    return { key: sendKey(ref), name: hit?.name ?? ref.id, found: Boolean(hit) };
  });
}

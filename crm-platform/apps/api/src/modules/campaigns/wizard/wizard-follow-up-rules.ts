import {
  WIZARD_FOLLOW_UP_MAX,
  wizardFollowUpSchema,
  type WizardFollowUp,
  type WizardFollowUpTrigger,
} from '@crm/contracts';

/** How often a watching step ("replied", "read") looks at its recipient while time remains. */
export const FOLLOW_UP_POLL_MS = 60_000;

export type FollowUpDecision =
  /** Nothing yet: look again at `checkAt`. */
  | { kind: 'wait'; checkAt: Date }
  /** The condition holds: do the step. */
  | { kind: 'fire' }
  /** A "not replied / not read" step whose recipient did react: the chain ends here. */
  | { kind: 'skip' }
  /** A "replied / read" step whose watch time ran out: the chain ends here. */
  | { kind: 'lapse' };

const WATCHING: ReadonlySet<WizardFollowUpTrigger> = new Set(['replied', 'read']);

/** When a step's time is up: `waitMinutes` after the message before it. */
export const followUpDeadline = (baseAt: Date, step: Pick<WizardFollowUp, 'waitMinutes'>): Date =>
  new Date(baseAt.getTime() + step.waitMinutes * 60_000);

/**
 * What a follow-up step does for one recipient right now. Pure: the caller says what the recipient did (`replied`: any message from
 * them since `baseAt`; `read`: the message before the step was read) and what time it is.
 *
 *   replied / read          fires the moment the event is there; lapses when `waitMinutes` pass without it; until then looks again
 *                           every minute (never later than the deadline).
 *   not_replied / not_read  does not look before the deadline; then fires if the event is missing. An event before the deadline ends
 *                           the chain at once: waiting would only delay the same answer.
 */
export function decideFollowUp(
  step: Pick<WizardFollowUp, 'trigger' | 'waitMinutes'>,
  o: { now: Date; baseAt: Date; replied: boolean; read: boolean },
): FollowUpDecision {
  const event = step.trigger === 'replied' || step.trigger === 'not_replied' ? o.replied : o.read;
  const deadline = followUpDeadline(o.baseAt, step);
  const due = o.now.getTime() >= deadline.getTime();
  if (WATCHING.has(step.trigger)) {
    if (event) return { kind: 'fire' };
    if (due) return { kind: 'lapse' };
    return {
      kind: 'wait',
      checkAt: new Date(Math.min(deadline.getTime(), o.now.getTime() + FOLLOW_UP_POLL_MS)),
    };
  }
  if (event) return { kind: 'skip' };
  if (due) return { kind: 'fire' };
  return { kind: 'wait', checkAt: deadline };
}

/** The follow-up steps stored on a campaign's draft, in order; anything unreadable is dropped (a draft saved before this existed has none). */
export function followUpsOf(wizard: { draft?: unknown } | null | undefined): WizardFollowUp[] {
  const raw =
    wizard?.draft && typeof wizard.draft === 'object'
      ? (wizard.draft as Record<string, unknown>).followUps
      : undefined;
  if (!Array.isArray(raw)) return [];
  const out: WizardFollowUp[] = [];
  for (const item of raw.slice(0, WIZARD_FOLLOW_UP_MAX)) {
    const parsed = wizardFollowUpSchema.safeParse(item);
    if (!parsed.success) break;
    out.push(parsed.data);
  }
  return out;
}

/** A provider's delivery status only moves forward (`sent`, `delivered`, `read`); `failed` can end any of them. */
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 };
export const followUpStatusIsNewer = (current: string | null, next: string): boolean =>
  (RANK[next] ?? 0) > (current ? (RANK[current] ?? 0) : 0);

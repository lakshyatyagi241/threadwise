import type { StatusOptionResponse } from '@crm/contracts';
import type { Choice } from './option-sets';

/**
 * Won / lost stages (Contact stages screen) as the contact screens use them: moving a contact into a lost stage asks why,
 * and the answer is a lost-reason option of the workspace or free text. Pure helpers, no React.
 */

/** The stage's meaning, as the screen's radio group offers it. */
export type StageMeaning = 'none' | 'won' | 'lost';

export const meaningOf = (o: { isWon?: boolean; isLost?: boolean }): StageMeaning =>
  o.isLost ? 'lost' : o.isWon ? 'won' : 'none';

export const flagsOf = (m: StageMeaning): { isWon: boolean; isLost: boolean } => ({
  isWon: m === 'won',
  isLost: m === 'lost',
});

/** Whether choosing this stage value means "lost" in the workspace's own list. */
export function isLostStage(choices: readonly Choice[], value: string | undefined): boolean {
  return value !== undefined && choices.some((c) => c.value === value && c.isLost === true);
}

/** The lost-reason options a contact can be given (module `contacts`, group `lost_reason`), in their saved order. */
export function lostReasonChoices(options: readonly StatusOptionResponse[] | undefined): Choice[] {
  return (options ?? [])
    .filter((o) => o.isActive && o.optionGroup === 'lost_reason')
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ value: o.value, label: o.label }));
}

/** The "Other (write it)" entry of the reason picker. It is never a stored value. */
export const OTHER_REASON = '__other__';

export interface LostReasonAnswer {
  /** A reason's value, OTHER_REASON, or '' for nothing chosen yet. */
  pick: string;
  /** Free text, used when `pick` is OTHER_REASON (or when the workspace has no reasons to pick from). */
  text: string;
}

export type LostReasonProblem = 'pick' | 'text';

/** What is missing from the answer: nothing chosen, or "other" chosen with no words. */
export function lostReasonProblem(
  answer: LostReasonAnswer,
  hasChoices: boolean,
): LostReasonProblem | null {
  if (!hasChoices || answer.pick === OTHER_REASON) return answer.text.trim() ? null : 'text';
  return answer.pick ? null : 'pick';
}

/**
 * The fields the API takes: a picked reason goes in `lostReason` (and clears any earlier free text), written words in
 * `otherLostReason`. `clearOther` is for updates, where null removes a stale value; a create just leaves the key out.
 */
export function lostReasonPayload(
  answer: LostReasonAnswer,
  hasChoices: boolean,
  clearOther = true,
): { lostReason?: string | null; otherLostReason?: string | null } {
  if (!hasChoices || answer.pick === OTHER_REASON) {
    return { otherLostReason: answer.text.trim(), ...(clearOther ? { lostReason: null } : {}) };
  }
  return { lostReason: answer.pick, ...(clearOther ? { otherLostReason: null } : {}) };
}

/** The answer a contact that is already lost currently gives (for the edit form to start from). */
export function answerFromContact(
  c: { lostReason: string | null; otherLostReason: string | null },
  choices: readonly Choice[],
): LostReasonAnswer {
  if (c.lostReason && choices.some((x) => x.value === c.lostReason)) {
    return { pick: c.lostReason, text: '' };
  }
  if (c.lostReason) return { pick: OTHER_REASON, text: c.lostReason };
  return { pick: c.otherLostReason ? OTHER_REASON : '', text: c.otherLostReason ?? '' };
}

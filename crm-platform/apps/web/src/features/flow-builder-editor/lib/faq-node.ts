import { FAQ_LIMITS, FLOW_FAQ_SAVE_DEFAULT } from '@crm/contracts';

/**
 * The "Answer from FAQ" node's data, read the way the runtime reads it (`runtime-shape.ts`): a blank minimum score means the
 * workspace's threshold, the variable name falls back to `faq`. Shared by the inspector form, the card and the Simple editor.
 */

export const FAQ_MIN_SCORE = {
  min: FAQ_LIMITS.thresholdMin,
  max: FAQ_LIMITS.thresholdMax,
} as const;
/** What a minimum score starts at when the author turns "Use the workspace setting" off. */
export const FAQ_MIN_SCORE_START = 0.5;
/** The flow variables the node writes (`<save>.<name>`). */
export const FAQ_VARIABLES = ['answer', 'matched', 'question', 'score', 'id'] as const;
export const FAQ_DEFAULT_QUERY = '{{user_message}}';

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/** True when the node carries its own minimum score (a typed value, even a half-typed one), not the workspace's. */
export const hasOwnMinScore = (v: unknown): boolean => !(v === null || v === undefined);

/** The score as a number, `null` for blank, `NaN` for something that is not a number. */
export function readMinScore(v: unknown): number | null {
  if (isBlank(v)) return null;
  return typeof v === 'number' ? v : Number(v);
}

/** The same check as the graph validation: a typed score outside 0.05 to 0.99 (or not a number) blocks publishing. */
export function minScoreOutOfRange(v: unknown): boolean {
  const n = readMinScore(v);
  if (n === null) return false;
  return !Number.isFinite(n) || n < FAQ_MIN_SCORE.min || n > FAQ_MIN_SCORE.max;
}

export const faqSaveName = (v: unknown): string =>
  (typeof v === 'string' ? v.trim() : '') || FLOW_FAQ_SAVE_DEFAULT;

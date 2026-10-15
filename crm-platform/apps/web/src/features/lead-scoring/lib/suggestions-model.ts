import type { LscSuggestion } from '@crm/contracts';

/** A confidence of 0 to 1 as the whole percent a person reads. */
export const confidencePercent = (c: number): number =>
  Math.round(Math.max(0, Math.min(1, c)) * 100);

/** The confidence from which "accept all" takes a suggestion (percent). */
export const BULK_ACCEPT_PERCENT = 85;

/** The suggestions that "accept all above N percent" would accept. */
export const bulkAcceptable = (
  items: readonly LscSuggestion[],
  percent = BULK_ACCEPT_PERCENT,
): LscSuggestion[] => items.filter((s) => confidencePercent(s.confidence) >= percent);

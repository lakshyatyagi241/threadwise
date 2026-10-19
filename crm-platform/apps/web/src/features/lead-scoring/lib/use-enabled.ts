'use client';

import { usePlanFeature } from '@/lib/plan-features';
import { useLscStatus } from '../api/hooks';

/** The plan feature the Marketplace app "AI lead scoring" grants. Scoring is offered to a workspace only while it has it. */
export const LEAD_SCORING_FEATURE = 'lead_scoring';

/**
 * Whether this workspace has the AI lead scoring app (installed, or granted by its plan or an override). Only the AI side of scoring
 * asks this (the Score button, the log, the chat reading, the growth card): they need the app whether or not the switch is on.
 * Unknown counts as on: the API refuses what the workspace lacks.
 *
 * Whether to DRAW a contact's lead score is a different question: `useLeadScoringEnabled`.
 */
export function useLeadScoringOn(): boolean {
  return usePlanFeature(LEAD_SCORING_FEATURE);
}

/**
 * The one rule for every place a contact's lead score is drawn (the chips, the Lead score card and tile, the list column and its
 * picker entry, the Hot leads chip, the score filter, the score field of the contact form, the field history): scoring is on for the
 * workspace when it has the app (`useLeadScoringOn`) AND it switched scoring on in its settings (`GET /lead-scoring/status`, open to
 * everyone who reads contacts).
 *
 * Off means off for everything, a score a person typed included: nothing is drawn (never an empty chip, card or column). The scores
 * stay stored; switching scoring on again brings them back. While the answer is on its way, or if it cannot be read, the score stays
 * hidden: a score is never shown on a guess. The status is only requested for a workspace that has the app.
 */
export function useLeadScoringEnabled(): boolean {
  const hasApp = useLeadScoringOn();
  const status = useLscStatus(hasApp);
  return hasApp && status.data?.enabled === true;
}

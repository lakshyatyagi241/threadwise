'use client';

import { usePlanFeature } from '@/lib/plan-features';

/** The plan feature the Marketplace app "AI lead scoring" grants. Scoring is offered to a workspace only while it has it. */
export const LEAD_SCORING_FEATURE = 'lead_scoring';

/**
 * Whether this workspace has AI lead scoring (the app is installed, or its plan or an override grants it). The parts of scoring that sit on
 * other screens (the score card on a contact, the chat reading in the inbox, the growth card) leave out what the workspace does not have.
 * The score itself, typed by a person, is part of the contact and stays. Unknown counts as on: the API refuses what the workspace lacks.
 */
export function useLeadScoringOn(): boolean {
  return usePlanFeature(LEAD_SCORING_FEATURE);
}

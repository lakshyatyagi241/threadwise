import { PLAN_FEATURE_KEYS } from '../plans-subscriptions-trials/catalogue';

/**
 * The plan feature that offers `team_and_below` ("My team and sub-teams") in the Roles matrix: parent teams, managers and the scope that
 * follows them (spec decision D4/D5, backlog BL-383, phase T3 of docs/specs/teams-unification.md).
 *
 * TODO(BL-383, T3): T3 adds the key `team_hierarchy` to `PLAN_FEATURE_DEFS` in its own change. Until that is merged this feature key does
 * not exist, so a missing key counts as ON: hierarchy is available to every workspace, which is what the flat product did before the
 * gate. The day the key is in the catalogue this helper starts honouring it with no further edit here; then delete this note.
 */
export const TEAM_HIERARCHY_FEATURE = 'team_hierarchy';

/** True when the catalogue defines the gate (T3 merged). */
export const teamHierarchyGateExists = (): boolean =>
  (PLAN_FEATURE_KEYS as string[]).includes(TEAM_HIERARCHY_FEATURE);

/**
 * Is `team_and_below` offered to a workspace? `enabled` says whether the workspace has the plan feature, `null` when that is unknown (the
 * caller then removes nothing). A catalogue without the key offers it to everybody (see the note above).
 */
export const teamHierarchyOffered = (enabled: boolean | null): boolean =>
  !teamHierarchyGateExists() || enabled === null || enabled;

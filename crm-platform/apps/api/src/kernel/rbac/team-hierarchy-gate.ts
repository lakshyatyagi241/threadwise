/**
 * Port for "does this workspace have the plan feature `team_hierarchy`" (BL-382, BL-383). The kernel may not import plan code, so the plans
 * module provides the answer behind this token (`TeamHierarchyGateModule`). `RbacService` uses it to narrow a stored `team_and_below`
 * scope to `team` for a workspace whose plan lacks the feature (a downgrade): the role keeps its grant and keeps working, it just reaches
 * no sub-teams until the feature is back.
 */
export const TEAM_HIERARCHY_GATE = Symbol('TEAM_HIERARCHY_GATE');

export interface TeamHierarchyGate {
  enabled(orgId: number): Promise<boolean>;
}

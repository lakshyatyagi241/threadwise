import type { HandoffSettings } from '@crm/contracts';
import { usePlanFeature } from '@/lib/plan-features';

export type SmartRoutingLock = 'inbox_routing' | 'inbox_assignment_sticky' | null;

/**
 * Which Smart routing parts of `/auto-assignment` the workspace has (docs/specs/addons-plan-offers.md, section 4;
 * packaging-teams-and-smart-routing.md): the plan features the layout read (`usePlanFeature`) combined with the server's own answer
 * where one exists (`available.*` of the handoff settings, a rules list refused with PLAN_FEATURE_LOCKED).
 *  - `routing` (`inbox_routing`): the master switch, the rules with Everyone else, Try it, the waiting-queue timers and the away rules;
 *  - `sticky` (`inbox_assignment_sticky` and `inbox_routing`): Sticky Agent, Assign Chat to Contact Owner and the owner and continuity
 *    settings under Advanced.
 * A part the workspace lacks is not drawn; `lock` is the feature the one lock card speaks for (null: nothing locked). Stored settings
 * are never touched. Unknown entitlements and settings not loaded yet count as "has it", like the menu: nothing is hidden on a guess.
 */
export function useSmartRouting(
  settings: HandoffSettings | undefined,
  rulesLocked = false,
): { routing: boolean; sticky: boolean; lock: SmartRoutingLock } {
  const routingPlan = usePlanFeature('inbox_routing');
  const stickyPlan = usePlanFeature('inbox_assignment_sticky');
  const routing = routingPlan && !rulesLocked && (settings?.available.autoAssign ?? true);
  const sticky = routing && stickyPlan && (settings?.available.ownerFirst ?? true);
  return {
    routing,
    sticky,
    lock: !routing ? 'inbox_routing' : !sticky ? 'inbox_assignment_sticky' : null,
  };
}

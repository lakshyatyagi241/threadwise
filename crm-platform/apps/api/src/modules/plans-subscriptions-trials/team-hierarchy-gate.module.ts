import { Global, Injectable, Module } from '@nestjs/common';
import { TEAM_HIERARCHY_GATE, type TeamHierarchyGate } from '../../kernel/rbac/team-hierarchy-gate';
import { PlanEntitlementService } from './plan-entitlement.service';
import { PlansCoreModule } from './plans-core.module';

/** Answers the kernel's `TEAM_HIERARCHY_GATE` port from the workspace's entitlements (plan, overrides and add-ons). */
@Injectable()
export class PlanTeamHierarchyGate implements TeamHierarchyGate {
  constructor(private readonly plan: PlanEntitlementService) {}

  enabled(orgId: number): Promise<boolean> {
    return this.plan.featureEnabled(orgId, 'team_hierarchy');
  }
}

/** Global so the kernel's `RbacService` (which sits below every module) can receive the port. Imported by the app and the worker. */
@Global()
@Module({
  imports: [PlansCoreModule],
  providers: [
    PlanTeamHierarchyGate,
    { provide: TEAM_HIERARCHY_GATE, useExisting: PlanTeamHierarchyGate },
  ],
  exports: [TEAM_HIERARCHY_GATE],
})
export class TeamHierarchyGateModule {}

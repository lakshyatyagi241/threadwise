import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, PLAN_UPGRADE_PATH, isUnlimitedFor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

/**
 * What the workspace's plan says about teams (docs/specs/teams-unification.md D4, BL-383): how many teams it may hold (`teams`: 0 = solo,
 * no teams) and whether it may use parent teams and manager scope (`team_hierarchy`). Kept apart from TeamsService on purpose: the teams
 * service is large and changes often, so it only calls the two methods below and nothing else here needs to move with it.
 *
 * Existing teams are never touched by a plan change: a workspace over its new cap keeps the teams it has and simply cannot add more.
 */
@Injectable()
export class TeamsPlanService {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  /**
   * Call before inserting a team, inside the creating request. Solo plan (cap 0): 422 PLAN_TEAMS_NOT_INCLUDED. Cap reached: 422
   * PLAN_LIMIT_REACHED (the standard problem fields: limit, reason, used, limitValue, upgradeUrl). Unlimited (the default for every plan
   * that predates the `teams` key) costs one entitlement read and no count.
   */
  async assertCanCreate(tx: Tx, orgId: number): Promise<void> {
    const cap = await this.entitlements.limit(orgId, 'teams');
    if (isUnlimitedFor('teams', cap)) return;
    if (cap === 0) {
      throw new AppError(
        ERROR_CODES.PLAN_TEAMS_NOT_INCLUDED,
        "Your plan doesn't include teams. Upgrade your plan, or ask for the Teams and permissions add-on, to group people into teams.",
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          { path: 'limit', message: 'teams' },
          { path: 'reason', message: 'teams_not_included' },
          { path: 'limitValue', message: '0' },
          { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
        ],
      );
    }
    const res = await tx.execute(sql`SELECT count(*)::int AS n FROM teams WHERE org_id = ${orgId}`);
    const used = Number((res.rows[0] as { n: number }).n);
    if (used < cap) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      `You've reached your plan's limit of ${cap} ${cap === 1 ? 'team' : 'teams'}. Upgrade your plan, or ask for the Teams and permissions add-on, to add more, or delete a team to free up space.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: 'teams' },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: String(used) },
        { path: 'limitValue', message: String(cap) },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  /** Whether parent teams and lead/manager scope are on for the workspace (the web hook is `usePlanFeature('team_hierarchy')`). */
  hierarchyEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, 'team_hierarchy');
  }

  /**
   * Teams v2 (T1) calls this when a request sets a parent team, a lead/manager or the `team_and_below` scope: 422 PLAN_FEATURE_LOCKED with
   * feature `team_hierarchy` when the plan (or the add-on) does not have it. Setting these fields back to empty is always allowed, so a
   * workspace that lost the feature can still clear what it set.
   */
  async assertHierarchy(orgId: number): Promise<void> {
    await this.entitlements.assertFeature(
      orgId,
      'team_hierarchy',
      "Parent teams and team managers aren't on your plan. Upgrade your plan, or ask for the Teams and permissions add-on, to use them.",
    );
  }
}

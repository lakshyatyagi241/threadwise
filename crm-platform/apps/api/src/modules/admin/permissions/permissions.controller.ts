import { Controller, Get, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq, inArray } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { PermissionDefResponse } from '@crm/contracts';
import { ActorKinds, CurrentActor, RequirePermission } from '../../../common/decorators';
import type { RequestContext } from '../../../common/context/request-context';
import { AddonEntitlementService } from '../../addons-extension-registry';
import { DatabaseService } from '../../../infra/db/database.service';

/**
 * The platform's capability registry — read-only. Roles & Permissions UI uses
 * this to render "what can a role be granted", not to enforce anything itself.
 */
@ApiTags('permissions')
// Phase 2 (docs/phase-plan.md) — same exclusion reason as users.controller.ts.
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'permissions', version: '2' })
export class PermissionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: AddonEntitlementService,
  ) {}

  @Get()
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'List every permission key the platform knows about' })
  async list(
    @CurrentActor() ctx: RequestContext,
    // `?includeLocked=1`: also return the keys the workspace does not have yet (plan feature off / app not installed), each marked
    // with `lock`, so the Roles editor can show them disabled with the reason. Without it the list is unchanged (hidden keys omitted).
    @Query('includeLocked') includeLocked?: string,
  ): Promise<{ data: PermissionDefResponse[] }> {
    const rows = await this.db.tx((tx) =>
      tx
        .select({
          key: schema.permissionDefs.key,
          label: schema.permissionDefs.label,
          category: schema.permissionDefs.category,
          supportsScope: schema.permissionDefs.supportsScope,
          planFeature: schema.permissionDefs.planFeature,
          appSlug: schema.permissionDefs.appSlug,
        })
        .from(schema.permissionDefs),
    );
    // An add-on's keys show only for a workspace that has the add-on (plan or purchase); core keys always show.
    const features = [...new Set(rows.map((r) => r.planFeature).filter((f): f is string => !!f))];
    const on = new Set<string>();
    const slugs = [...new Set(rows.map((r) => r.appSlug).filter((a): a is string => !!a))];
    const installed = new Set<string>();
    if (slugs.length > 0) {
      // Installed means the workspace has the app (paused counts: the admin still manages who may use it). RLS scopes this to the caller.
      const found = await this.db.txAs({ orgId: ctx.orgId, userId: null }, (tx) =>
        tx
          .select({ slug: schema.marketplaceApps.slug })
          .from(schema.workspaceAppInstallations)
          .innerJoin(
            schema.marketplaceApps,
            eq(schema.marketplaceApps.id, schema.workspaceAppInstallations.appId),
          )
          .where(inArray(schema.marketplaceApps.slug, slugs)),
      );
      for (const f of found) installed.add(f.slug);
    }
    for (const f of features) if (await this.entitlements.featureEnabled(ctx.orgId, f)) on.add(f);
    // A Marketplace app's plan feature is on only while the app is installed and running (plans-subscriptions-trials/app-grants.ts). A
    // feature that is off because the workspace subscribed but has not installed the app is an `app` lock (install it), not a plan
    // lock (upgrade). A PAUSED app counts as installed here: the admin still manages who may use it once it is resumed.
    const withheld = features.some((f) => !on.has(f))
      ? await this.entitlements.withheldByApps(ctx.orgId)
      : {};
    const planOk = (r: (typeof rows)[number]) =>
      !r.planFeature || on.has(r.planFeature) || withheld[r.planFeature]?.installed === true;
    // A feature the plan itself carries is on without any installation, so an app slug never closes a key whose plan feature is on.
    const appOk = (r: (typeof rows)[number]) =>
      !r.appSlug || installed.has(r.appSlug) || (!!r.planFeature && on.has(r.planFeature));
    const open = (r: (typeof rows)[number]) => planOk(r) && appOk(r);
    if (includeLocked === '1' || includeLocked === 'true') {
      return {
        data: rows.map((r) => {
          if (open(r)) return r;
          const held = r.planFeature ? withheld[r.planFeature] : undefined;
          const lock: PermissionDefResponse['lock'] = !planOk(r)
            ? held
              ? { kind: 'app', slug: held.slug }
              : { kind: 'plan_feature', key: r.planFeature! }
            : { kind: 'app', slug: r.appSlug! };
          return { ...r, lock };
        }),
      };
    }
    return { data: rows.filter(open) };
  }
}

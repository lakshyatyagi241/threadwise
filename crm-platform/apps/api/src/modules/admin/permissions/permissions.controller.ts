import { Controller, Get } from '@nestjs/common';
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
  async list(@CurrentActor() ctx: RequestContext): Promise<{ data: PermissionDefResponse[] }> {
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
    return {
      data: rows.filter(
        (r) =>
          (!r.planFeature || on.has(r.planFeature)) && (!r.appSlug || installed.has(r.appSlug)),
      ),
    };
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { disableAddonRequestSchema, uuidSchema, type DisableAddonRequest } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequestContextStore } from '../../common/context/request-context';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { AddonLifecycleService } from './addon-lifecycle.service';
import { WorkspaceAddonsService } from './workspace-addons.service';

/**
 * What a workspace sees of the add-on catalogue (TW-ADD-033): readable by any signed-in member, like the plan
 * list, because it only describes products and the workspace's own purchases. Buying is checkout's route.
 */
@ApiTags('addons')
@ActorKinds('user')
@Controller({ path: 'addons', version: '2' })
export class AddonsController {
  constructor(
    private readonly addons: WorkspaceAddonsService,
    private readonly lifecycle: AddonLifecycleService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Add-ons on sale, what the workspace owns, each card state, and whether the plan and the caller may buy',
  })
  async list() {
    // Anyone may SEE the list; whether this member may BUY (checkout's own key) rides along so the card can disable the button with a reason.
    const ctx = RequestContextStore.require();
    const grants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId!);
    return this.addons.forCurrentWorkspace(this.rbac.can(grants, 'paygw.checkout.create').allowed);
  }

  @Get(':id/impact')
  @RequirePermission('addons.activation.manage')
  @ApiOperation({
    summary:
      'What turning an included add-on off (or on) does for this workspace: features, dependents, roles, waiting work',
  })
  impact(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Query('action', zodPipe(z.enum(['disable', 'enable']).default('disable')))
    action: 'disable' | 'enable',
  ) {
    return this.lifecycle.impact(id, action);
  }

  @Post(':id/disable')
  @Idempotent()
  @RequirePermission('addons.activation.manage')
  @ApiOperation({
    summary: 'Turn an add-on the plan includes off for this workspace (settings and data are kept)',
  })
  disable(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(disableAddonRequestSchema)) _body: DisableAddonRequest,
  ) {
    return this.lifecycle.disable(id);
  }

  @Post(':id/enable')
  @Idempotent()
  @RequirePermission('addons.activation.manage')
  @ApiOperation({ summary: 'Turn an add-on the plan includes back on' })
  enable(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.lifecycle.enable(id);
  }
}

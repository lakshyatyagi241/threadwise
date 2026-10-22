import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { RbacService } from '../../kernel/rbac/rbac.service';
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
}

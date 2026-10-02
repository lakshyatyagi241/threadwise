import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds } from '../../common/decorators';
import { WorkspaceAddonsService } from './workspace-addons.service';

/**
 * What a workspace sees of the add-on catalogue (TW-ADD-033): readable by any signed-in member, like the plan
 * list, because it only describes products and the workspace's own purchases. Buying is checkout's route.
 */
@ApiTags('addons')
@ActorKinds('user')
@Controller({ path: 'addons', version: '2' })
export class AddonsController {
  constructor(private readonly addons: WorkspaceAddonsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Add-ons on sale, what the workspace owns, and whether it may buy (needs an active paid plan)',
  })
  list() {
    return this.addons.forCurrentWorkspace();
  }
}

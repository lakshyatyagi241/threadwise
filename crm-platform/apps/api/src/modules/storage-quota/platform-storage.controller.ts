import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { uuidSchema } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { StorageFleetService } from './storage-fleet.service';

/**
 * The operator's storage view (storage quota phase S1, docs/specs/storage-quota-and-archival.md 11.1): READ ONLY. The fleet, and one
 * workspace's panel. Reading needs `platform.workspace.view_all`; the actions (reconcile now, re-evaluate a cap, grants) arrive with the
 * keys `platform.workspace.storage` and `platform.workspace.storage_grant`, which are already seeded but guard no route yet.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/storage', version: '2' })
export class PlatformStorageController {
  constructor(private readonly fleet: StorageFleetService) {}

  @Get('fleet')
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary:
      'Storage across every workspace: totals, usage by category, the biggest workspaces, levels and counter drift (read only)',
  })
  fleetView() {
    return this.fleet.fleet();
  }

  @Get('workspaces/:id')
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary: "One workspace's storage: used, cap, level and the breakdown (read only, audited)",
  })
  workspace(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.fleet.workspace(id);
  }
}

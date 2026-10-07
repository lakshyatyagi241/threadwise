import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listWorkspaceHubQuerySchema,
  suspendWorkspaceHubRequestSchema,
  uuidSchema,
  type ListWorkspaceHubQuery,
  type SuspendWorkspaceHubRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { PlatformWorkspacesService } from './platform-workspaces.service';

/**
 * The operator's Workspaces hub (WD-WSP-023/025): the list of every workspace, one workspace's dashboard, and suspend / lift.
 * Reading needs `platform.workspace.view_all`; suspending and lifting need the inbox's own keys, and the inbox writes their audit
 * trail. Plan, provider and wallet changes stay on their own domains' endpoints.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/workspaces', version: '2' })
export class PlatformWorkspacesController {
  constructor(private readonly workspaces: PlatformWorkspacesService) {}

  @Get()
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary: 'Every workspace with plan, provider, wallet, owner and activity (keyset cursor)',
  })
  list(@Query(zodPipe(listWorkspaceHubQuerySchema)) query: ListWorkspaceHubQuery) {
    return this.workspaces.list(query);
  }

  @Get(':id')
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary: 'One workspace: its hub row, counts, 30-day messages and what the caller may do',
  })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.workspaces.detail(id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @PlatformPermission('platform.workspace.suspend')
  @ApiOperation({ summary: 'Suspend a workspace (frozen flag); returns the refreshed hub row' })
  suspend(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(suspendWorkspaceHubRequestSchema)) body: SuspendWorkspaceHubRequest,
  ) {
    return this.workspaces.suspend(id, body);
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  @PlatformPermission('platform.workspace.unsuspend')
  @ApiOperation({
    summary: 'Lift a suspension (clears the frozen flag only); returns the refreshed hub row',
  })
  unsuspend(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.workspaces.unsuspend(id);
  }
}

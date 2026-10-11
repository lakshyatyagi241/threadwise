import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listOrgLifecycleQuerySchema,
  restoreOrgSchema,
  setOrgLegalHoldSchema,
  setOrgRetentionExemptSchema,
  updateOrgRetentionPolicySchema,
  uuidSchema,
  type ListOrgLifecycleQuery,
  type RestoreOrgInput,
  type SetOrgLegalHoldInput,
  type SetOrgRetentionExemptInput,
  type UpdateOrgRetentionPolicyInput,
} from '@crm/contracts';
import { ActorKinds, CurrentActor, Idempotent } from '../../common/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { LifecycleService, type Actor } from './lifecycle/lifecycle.service';

const actorOf = (ctx: RequestContext): Actor => ({
  type: 'platform_operator',
  ref: `platform_operator:${ctx.actorId}`,
});

/**
 * The operator's retention controls, on their own path (a `/platform/workspaces/lifecycle` would collide with the hub's `:id`) for the inactivity lifecycle (ADR-0028): which workspaces are idle and when they will be archived and
 * erased, the timings per workspace, the never-delete switch, the legal hold, restore. Reading needs `platform.workspace.view_all`;
 * changing timings, never-delete and restore need `platform.workspace.retention`; the legal hold has its own key (Super Admin only).
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/workspace-lifecycle', version: '2' })
export class PlatformWorkspaceLifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary: 'Workspaces with inactivity, schedule and retention state (keyset cursor)',
  })
  list(@Query(zodPipe(listOrgLifecycleQuerySchema)) q: ListOrgLifecycleQuery) {
    return this.lifecycle.list(q);
  }

  @Get(':id')
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({ summary: 'One workspace lifecycle state' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.lifecycle.get(id);
  }

  @Get(':id/log')
  @PlatformPermission('platform.workspace.view_all')
  @ApiOperation({
    summary: 'Compliance history: reminders, archive, restore, policy, exemption and hold changes',
  })
  history(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.lifecycle.history(id);
  }

  @Patch(':id/policy')
  @Idempotent()
  @PlatformPermission('platform.workspace.retention')
  @ApiOperation({ summary: 'Change archive/delete timing for one workspace (null = default)' })
  updatePolicy(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateOrgRetentionPolicySchema)) body: UpdateOrgRetentionPolicyInput,
    @CurrentActor() ctx: RequestContext,
  ) {
    return this.lifecycle.updatePolicy(id, body, actorOf(ctx));
  }

  @Post(':id/exemption')
  @HttpCode(200)
  @Idempotent()
  @PlatformPermission('platform.workspace.retention')
  @ApiOperation({ summary: 'Mark a workspace never-archive / never-delete, or clear it' })
  setExempt(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setOrgRetentionExemptSchema)) body: SetOrgRetentionExemptInput,
    @CurrentActor() ctx: RequestContext,
  ) {
    return this.lifecycle.setExempt(id, body, actorOf(ctx));
  }

  @Post(':id/legal-hold')
  @HttpCode(200)
  @Idempotent()
  @PlatformPermission('platform.workspace.legal_hold')
  @ApiOperation({ summary: 'Place or release a legal hold (blocks archive and erase)' })
  setLegalHold(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setOrgLegalHoldSchema)) body: SetOrgLegalHoldInput,
    @CurrentActor() ctx: RequestContext,
  ) {
    return this.lifecycle.setLegalHold(id, body, actorOf(ctx));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Idempotent()
  @PlatformPermission('platform.workspace.retention')
  @ApiOperation({ summary: 'Restore an archived workspace and restart its inactivity clock' })
  restore(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(restoreOrgSchema)) body: RestoreOrgInput,
    @CurrentActor() ctx: RequestContext,
  ) {
    return this.lifecycle.restore(id, body, actorOf(ctx));
  }
}

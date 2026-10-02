import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attachPlanRequestSchema,
  uuidSchema,
  workspacePlanListQuerySchema,
  type AttachPlanRequest,
  type WorkspacePlanListQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WorkspacePlanAdminService } from './workspace-plan-admin.service';

/**
 * Which plan each workspace is on, and its own caps (super admin only). Reading is open to every operator role, as with the plan
 * catalogue; attaching a plan or overriding a cap is a super-admin action.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/workspace-plans', version: '2' })
export class PlatformWorkspacePlansController {
  constructor(private readonly workspaces: WorkspacePlanAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Workspaces with their plan, validity and overrides (cursor pagination)',
  })
  list(@Query(zodPipe(workspacePlanListQuerySchema)) query: WorkspacePlanListQuery) {
    return this.workspaces.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One workspace’s plan state' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.workspaces.get(id);
  }

  @Put(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Attach a plan to a workspace and set its overrides (super admin only)',
  })
  attach(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(attachPlanRequestSchema)) body: AttachPlanRequest,
  ) {
    return this.workspaces.attach(id, body);
  }
}

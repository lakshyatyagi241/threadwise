import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attachPlanRequestSchema,
  retentionRunRequestSchema,
  type RetentionRunRequest,
  type RetentionRunResponse,
  uuidSchema,
  workspacePlanListQuerySchema,
  type AttachPlanRequest,
  type WorkspacePlanListQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { PlanRetentionService } from './plan-retention.service';
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
  constructor(
    private readonly workspaces: WorkspacePlanAdminService,
    private readonly retention: PlanRetentionService,
  ) {}

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

  @Post('retention/run')
  @HttpCode(200)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Data-retention wipe of lapsed workspaces (WD-PLAN-023): a dry run by default (counts, rolls back); a real run needs confirm "WIPE"',
  })
  async runRetention(
    @Body(zodPipe(retentionRunRequestSchema)) body: RetentionRunRequest,
  ): Promise<RetentionRunResponse> {
    const dryRun = body.dryRun ?? true;
    const done = await this.retention.sweep({ dryRun });
    return {
      dryRun,
      workspaces: done.map((d) => ({ slug: d.slug, wiped: d.wiped, rows: d.rows })),
    };
  }
}

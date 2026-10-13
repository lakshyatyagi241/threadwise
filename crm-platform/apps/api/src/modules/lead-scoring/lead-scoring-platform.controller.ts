import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  lscPlatformRunsQuerySchema,
  lscPlatformWorkspacesQuerySchema,
  updateLscPlatformConfigSchema,
  type LscPlatformRunsQuery,
  type LscPlatformWorkspacesQuery,
  type UpdateLscPlatformConfigInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { LeadScoringPlatformService } from './lead-scoring-platform.service';

/** The platform operator's control of AI lead scoring. Super admins only, reads included: cost and usage are not for every role. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/lead-scoring', version: '2' })
export class LeadScoringPlatformController {
  constructor(private readonly platform: LeadScoringPlatformService) {}

  @Get()
  @ApiOperation({
    summary: 'The switch, the model, the limits, and what scoring cost over 24 hours and 30 days',
  })
  overview() {
    return this.platform.overview();
  }

  @Get('workspaces')
  @ApiOperation({ summary: 'Workspaces by AI scoring cost, with the number of contacts scored' })
  workspaces(@Query(zodPipe(lscPlatformWorkspacesQuerySchema)) query: LscPlatformWorkspacesQuery) {
    return this.platform.workspaces(query);
  }

  @Get('runs')
  @ApiOperation({
    summary:
      'The scoring log across workspaces, newest first: score, tokens, cost in USD and who paid',
    description: 'Cursor pages of 25 by default.',
  })
  runs(@Query(zodPipe(lscPlatformRunsQuerySchema)) query: LscPlatformRunsQuery) {
    return this.platform.runs(query);
  }

  @Patch()
  @ApiOperation({
    summary: 'Switch AI lead scoring on or off for the platform, change the model or the limits',
  })
  update(@Body(zodPipe(updateLscPlatformConfigSchema)) body: UpdateLscPlatformConfigInput) {
    return this.platform.update(body);
  }
}

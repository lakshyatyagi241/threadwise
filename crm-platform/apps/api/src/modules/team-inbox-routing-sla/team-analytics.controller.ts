import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { teamAnalyticsQuerySchema, type TeamAnalyticsQuery } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { TeamAnalyticsService } from './team-analytics.service';

/** The Team Inbox reports (TW-TIB2-034). Reference left the JSON open to every member; here it needs the report permission and the plan feature. */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox/analytics', version: '2' })
export class TeamAnalyticsController {
  constructor(private readonly analytics: TeamAnalyticsService) {}

  @Get('team')
  @RequirePermission('inbox.analytics.view')
  @RequirePlanFeature('team_performance')
  @ApiOperation({
    summary: 'Team Performance: replies, resolutions and first-reply time per agent',
    description:
      '`range` is today (default), week (from Monday) or month, in the workspace time zone; anything else reads as today. `channelId` narrows every figure to one channel. Automatic replies are not counted as an agent’s replies.',
  })
  async team(@Query(zodPipe(teamAnalyticsQuerySchema)) query: TeamAnalyticsQuery) {
    return this.analytics.report(query);
  }
}

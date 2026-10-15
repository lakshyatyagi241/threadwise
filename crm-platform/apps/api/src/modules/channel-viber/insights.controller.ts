import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { viberInsightsQuerySchema, type ViberInsightsQuery } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { InsightsService } from './insights.service';

/** Viber insights (TW-VIB-016). */
@ApiTags('viber')
@ActorKinds('user')
@RequirePlanFeature('extra_channels')
@Controller({ path: 'viber/insights', version: '2' })
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  @RequirePermission('viber.channels.read')
  @ApiOperation({
    summary:
      "A channel's message volume per day, active users and delivered, seen and failed counts over the last 7 days",
    description:
      "`channel` picks the channel (the oldest when absent); `tz` is the viewer's IANA time zone for the days (UTC when absent or unknown).",
  })
  view(@Query(zodPipe(viberInsightsQuerySchema)) query: ViberInsightsQuery) {
    return this.insights.view(query);
  }
}

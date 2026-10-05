import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { insightsQuerySchema, type InsightsQuery } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InsightsService } from './insights.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

/** Facebook Page insights (TW-FB-019). */
@ApiTags('facebook')
@ActorKinds('user')
// Facebook management is entirely the extra-channels feature; the public webhook controller stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'facebook/insights', version: '2' })
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  @RequirePermission('fb.insights.read')
  @ApiOperation({
    summary:
      "A Page's identity, live 28 day metrics, local analytics, a 14 day message trend and recent posts",
    description:
      "`page` picks the Page (the first connected one when absent); `tz` is the viewer's IANA time zone for the trend (UTC when absent or unknown). " +
      'A metric Meta no longer has is absent from `kpis`; Meta not answering leaves the local numbers.',
  })
  view(@Query(zodPipe(insightsQuerySchema)) query: InsightsQuery) {
    return this.insights.view(query);
  }
}

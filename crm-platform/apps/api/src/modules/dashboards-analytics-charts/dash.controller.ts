import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsQuerySchema,
  dashSummaryQuerySchema,
  type AnalyticsQuery,
  type DashSummaryQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { DashService } from './dash.service';

/** Workspace dashboard (WD-DASH-001..005, 012, 018). Read-only; gated on `dash.dashboard.read` (WaDesk: role manager or above). */
@ApiTags('dashboard')
@ActorKinds('user')
@Controller({ path: 'dashboard', version: '2' })
export class DashboardController {
  constructor(private readonly dash: DashService) {}

  @Get('summary')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({ summary: 'KPI cards, sparkline and funnel for a range (24h, 7d, 30d, qtd)' })
  summary(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.summary(q.range);
  }

  @Get('widgets')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({
    summary:
      'Contacts, campaigns, devices, templates, inbox, pipeline and activity cards for a range',
  })
  widgets(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.widgets(q.range);
  }

  @Get('throughput')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({
    summary: 'Sent, delivered and failed per bucket, with peak and average per hour',
  })
  throughput(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.throughput(q.range);
  }
}

/** Workspace analytics (WD-DASH-022..032): `dash.analytics.read` and the plan's analytics feature. */
@ApiTags('analytics')
@ActorKinds('user')
@RequirePlanFeature('analytics')
@Controller({ path: 'analytics', version: '2' })
export class AnalyticsController {
  constructor(private readonly dash: DashService) {}

  @Get('overview')
  @RequirePermission('dash.analytics.read')
  @ApiOperation({
    summary: 'Totals with trends, daily series, funnel, type mix and hour heatmap for a window',
  })
  overview(@Query(zodPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.dash.analytics(q);
  }

  @Get('export')
  @RequirePermission('dash.analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="analytics.csv"')
  @ApiOperation({ summary: 'The same window as CSV' })
  export(@Query(zodPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.dash.analyticsCsv(q);
  }
}

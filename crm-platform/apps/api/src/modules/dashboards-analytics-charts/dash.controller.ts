import { Body, Controller, Get, Header, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsQuerySchema,
  quickAccessUpdateSchema,
  type QuickAccessUpdate,
  dashSummaryQuerySchema,
  type AnalyticsQuery,
  type DashSummaryQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { DashService } from './dash.service';
import { QuickAccessService } from './quick-access.service';

/** Workspace dashboard (WD-DASH-001..005, 012, 018). Read-only; gated on `dash.dashboard.read` (WaDesk: role manager or above). */
@ApiTags('dashboard')
@ActorKinds('user')
@Controller({ path: 'dashboard', version: '2' })
export class DashboardController {
  constructor(private readonly dash: DashService) {}

  @Get('summary')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({
    summary: 'KPI cards, sparkline and funnel for a range (24h, 7d, 30d, qtd, custom)',
  })
  summary(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.summary(q.range, undefined, q);
  }

  @Get('widgets')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({
    summary:
      'Contacts, campaigns, devices, templates, inbox, pipeline and activity cards for a range',
  })
  widgets(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.widgets(q.range, undefined, q);
  }

  @Get('throughput')
  @RequirePermission('dash.dashboard.read')
  @ApiOperation({
    summary: 'Sent, delivered and failed per bucket, with peak and average per hour',
  })
  throughput(@Query(zodPipe(dashSummaryQuerySchema)) q: DashSummaryQuery) {
    return this.dash.throughput(q.range, undefined, q);
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

  @Get('panels')
  @RequirePermission('dash.analytics.read')
  @ApiOperation({
    summary: 'Per-device sends, top templates, top conversations and team performance',
  })
  panels(@Query(zodPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.dash.panels(q);
  }

  @Get('export')
  @RequirePermission('dash.analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'The same window as CSV, named after the app and the dates' })
  async export(
    @Query(zodPipe(analyticsQuerySchema)) q: AnalyticsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.dash.analyticsCsv(q);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(Buffer.from(file.body, 'utf8'));
  }
}

/** Quick-access tiles (WD-DASH-009): any signed-in user, own row only (WaDesk: auth middleware, no role or plan gate). */
@ApiTags('quick-access')
@ActorKinds('user')
@Controller({ path: 'quick-access', version: '2' })
export class QuickAccessController {
  constructor(private readonly quick: QuickAccessService) {}

  @Get()
  @ApiOperation({
    summary: 'The shortcut tiles of the caller (the ten defaults until they customise)',
  })
  get() {
    return this.quick.get();
  }

  @Put()
  @ApiOperation({ summary: 'Save the shortcut tiles of the caller (max 10, sanitised)' })
  save(@Body(zodPipe(quickAccessUpdateSchema)) body: QuickAccessUpdate) {
    return this.quick.save(body.items);
  }
}

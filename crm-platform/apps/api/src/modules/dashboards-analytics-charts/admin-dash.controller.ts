import { Controller, Get, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  adminAnalyticsQuerySchema,
  adminOverviewWindowSchema,
  type AdminAnalyticsQuery,
  type AdminOverviewWindow,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { PlatformMetricsService } from './platform-metrics.service';

const overviewQuery = z.object({ window: adminOverviewWindowSchema });

/**
 * The operator's overview and analytics (TW-DASH-034..044). They show every workspace's money, so, like the revenue reports, they are
 * for super admins and the read-only auditor; support operators are refused.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin', 'auditor')
@Controller({ path: 'platform/dashboard', version: '2' })
export class AdminDashController {
  constructor(private readonly metrics: PlatformMetricsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'KPI cards, revenue chart, gateway mix, workspaces and alerts for a window',
  })
  overview(@Query(zodPipe(overviewQuery)) q: { window: AdminOverviewWindow }) {
    return this.metrics.overview(q.window);
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Platform KPIs, signups, plan mix, devices, leaderboard and tickets for N days',
  })
  analytics(@Query(zodPipe(adminAnalyticsQuerySchema)) q: AdminAnalyticsQuery) {
    return this.metrics.analytics(q.days);
  }

  @Get('analytics/export')
  @ApiOperation({ summary: 'Daily signup counts for the window as CSV' })
  async export(
    @Query(zodPipe(adminAnalyticsQuerySchema)) q: AdminAnalyticsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.metrics.signupsCsv(q.days);
    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(Buffer.from(file.body, 'utf8'));
  }
}

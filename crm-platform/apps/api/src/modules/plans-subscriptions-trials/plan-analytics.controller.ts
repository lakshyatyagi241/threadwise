import { Controller, Get, Header, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  financialWindowSchema,
  planAnalyticsQuerySchema,
  type FinancialWindow,
  type PlanAnalyticsQuery,
} from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.schema';
import { OperatorGuard, OperatorRoles } from '../auth';
import { PlanAnalyticsService } from './plan-analytics.service';

const windowQuery = z.object({ window: financialWindowSchema.default('30d') });

/**
 * The revenue reports (WD-PLAN-024..027). They show every workspace's money, so reading is for super admins only (WaDesk: the admin
 * group); support and auditor operators are refused.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform', version: '2' })
export class PlatformPlanAnalyticsController {
  constructor(
    private readonly analytics: PlanAnalyticsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('plan-analytics')
  @ApiOperation({ summary: 'Package analytics over 30, 90 or 365 days (anything else is 90)' })
  overview(@Query(zodPipe(planAnalyticsQuerySchema)) q: { days: 30 | 90 | 365; package?: string }) {
    return this.analytics.overview(q.days, q.package);
  }

  @Get('plan-analytics/export')
  @Header('Content-Type', 'text/csv; charset=UTF-8')
  @ApiOperation({ summary: 'The same numbers as one CSV download' })
  async export(
    @Query(zodPipe(planAnalyticsQuerySchema)) q: { days: 30 | 90 | 365; package?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.analytics.csv(
      q.days,
      q.package,
      this.config.get('APP_NAME', { infer: true }),
    );
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(Buffer.from(file.body, 'utf8'));
  }

  @Get('financial')
  @ApiOperation({ summary: 'Revenue, MRR, ARR, refunds, outstanding, charts and latest orders' })
  financial(@Query(zodPipe(windowQuery)) q: { window: FinancialWindow }) {
    return this.analytics.financial(q.window);
  }

  @Get('premium')
  @ApiOperation({
    summary: 'Paid vs free workspaces, ARPU, conversion, plan mix and revenue by plan',
  })
  premium(@Query(zodPipe(windowQuery)) q: { window: FinancialWindow }) {
    return this.analytics.premium(q.window);
  }
}

export type { PlanAnalyticsQuery };

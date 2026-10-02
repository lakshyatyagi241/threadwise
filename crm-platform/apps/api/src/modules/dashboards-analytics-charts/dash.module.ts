import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AnalyticsPlanGuard } from './dash-plan';
import { AnalyticsController, DashboardController } from './dash.controller';
import { DashRepository } from './dash.repository';
import { DashService } from './dash.service';

/** Dashboards and analytics (DASH): read-only aggregates over the message streams; owns no table. */
@Module({
  imports: [PlansCoreModule],
  controllers: [DashboardController, AnalyticsController],
  providers: [DashService, DashRepository, AnalyticsPlanGuard],
})
export class DashboardsAnalyticsChartsModule {}

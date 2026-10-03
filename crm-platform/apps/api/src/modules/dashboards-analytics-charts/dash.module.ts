import { Module } from '@nestjs/common';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AnalyticsController, DashboardController } from './dash.controller';
import { DashRepository } from './dash.repository';
import { DashWidgetsRepository } from './dash-widgets.repository';
import { DashService } from './dash.service';
import { AdminDashController } from './admin-dash.controller';
import { HealthController } from './health.controller';
import { PlatformMetricsService } from './platform-metrics.service';
import { HealthService } from './health.service';

/** Dashboards and analytics (DASH): read-only aggregates over the message streams, plus the operator system health; owns no table. */
@Module({
  imports: [PlansCoreModule, NodeBridgeRuntimeModule],
  controllers: [DashboardController, AnalyticsController, HealthController, AdminDashController],
  providers: [
    DashService,
    DashRepository,
    DashWidgetsRepository,
    HealthService,
    PlatformMetricsService,
  ],
})
export class DashboardsAnalyticsChartsModule {}

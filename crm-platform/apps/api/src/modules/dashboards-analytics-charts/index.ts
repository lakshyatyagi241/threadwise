/** Public surface of the dashboards-analytics-charts domain. */
export { DashboardsAnalyticsChartsModule } from './dash.module';
export { monthlyOf } from './platform-metrics.service';
export { Fx, healthOf, money2 } from './platform-rules';
/** The read services the AI report assistant calls for the screen's live numbers (workspace dashboard and analytics; operator overview). */
export { DashService } from './dash.service';
export { PlatformMetricsService } from './platform-metrics.service';

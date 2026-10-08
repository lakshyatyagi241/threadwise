import { Module } from '@nestjs/common';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { DashboardsAnalyticsChartsModule } from '../dashboards-analytics-charts';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformReportCopilotController } from './platform-report-copilot.controller';
import { ReportAiService } from './report-ai.service';
import { ReportCopilotController } from './report-copilot.controller';
import { ReportDocumentsRepository } from './report-documents.repository';
import { ReportDocumentsService } from './report-documents.service';
import { ReportRuntimeService } from './report-runtime.service';
import { ReportToolsFactory } from './report-tools';

/**
 * The AI report assistant (CopilotKit) on the workspace Dashboard and the platform Overview: a document library per screen, the
 * assistant's tools over those documents and the screen's live numbers, and the CopilotKit runtime mounted behind Nest routes.
 * It reads the dashboard and platform-metrics services and the AI keys domain through their barrels and owns two tables
 * (`report_documents`, `platform_report_documents`). Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule, DashboardsAnalyticsChartsModule, PlansCoreModule],
  controllers: [ReportCopilotController, PlatformReportCopilotController],
  providers: [
    ReportDocumentsRepository,
    ReportDocumentsService,
    ReportAiService,
    ReportToolsFactory,
    ReportRuntimeService,
  ],
})
export class ReportCopilotModule {}

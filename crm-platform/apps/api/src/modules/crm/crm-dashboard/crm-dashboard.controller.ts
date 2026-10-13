import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  crmDashboardQuerySchema,
  type CrmDashboardQuery,
  type RecordScope,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { CrmDashboardService } from './crm-dashboard.service';

/**
 * The CRM dashboard (Reference: `GET /crm`, plan feature `access_sales_pipeline`). It rides on the deals read capability and the same
 * plan gate as the deals screens; the sections that read other tables (contacts and lead sources, tasks, invoices and payments)
 * come back `null` unless the caller also holds that table's read capability, and every figure is cut to the caller's record scope
 * over that table.
 */
@ApiTags('crm-dashboard')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'crm', version: '2' })
export class CrmDashboardController {
  constructor(private readonly dashboard: CrmDashboardService) {}

  @Get('dashboard')
  @RequirePermission('record.deals.read')
  @ApiOperation({
    summary: 'The CRM dashboard for a period, pipeline, owner and team',
    description:
      'Deal KPIs, the pipeline funnel, the won/lost trend, lead sources, the owner leaderboard, tasks, receivables and recent activity, in the viewer time zone. Money is per currency; pass `convertTo` for one currency.',
  })
  async get(
    @Query(zodPipe(crmDashboardQuerySchema)) query: CrmDashboardQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.dashboard.dashboard(query, scope);
  }
}

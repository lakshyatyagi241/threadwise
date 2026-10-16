import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  REVENUE_PERMISSIONS,
  requestRevenueExportSchema,
  revenueReportQuerySchema,
  type RecordScope,
  type RequestRevenueExport,
  type RevenueReportQuery,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { Throttle } from '../../platform-infrastructure';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { RevenueExportService } from './revenue-export.service';
import { RevenueReportService } from './revenue-report.service';

/**
 * The revenue report (Reference: `GET /crm/revenue`, `.csv`, `.pdf`, plan feature `access_sales_pipeline`). The report rides on the
 * payments read capability and the same plan gate as the deals screens; every figure is cut to the caller's record scope over invoices
 * and payments. A file (CSV or PDF) is prepared by the worker and needs `record.payments.export` as well. Literal paths come first.
 */
@ApiTags('crm-revenue')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'crm/revenue', version: '2' })
export class RevenueReportController {
  constructor(
    private readonly report: RevenueReportService,
    private readonly exports: RevenueExportService,
  ) {}

  @Get()
  @RequirePermission(REVENUE_PERMISSIONS.read)
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'The revenue report for a period, with a comparison and a grouping',
    description:
      'Invoiced, credited, paid, outstanding and overdue for the invoices issued in the period, collected and refunded for the money received in it, the table by lead source, invoice origin, product, owner or team, the trend and the receivables aging, in the viewer time zone. Money is per currency; pass `convertTo` for one currency or `currency` for only one.',
  })
  get(
    @Query(zodPipe(revenueReportQuerySchema)) query: RevenueReportQuery,
    @GrantedScope(REVENUE_PERMISSIONS.read) scope: RecordScope,
  ) {
    return this.report.report(query, scope);
  }

  @Post('exports')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(REVENUE_PERMISSIONS.export)
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Prepare the report as a CSV (payments or summary) or a PDF in the background; announced by email (202)',
    description:
      'One at a time per person: 409 REVENUE_EXPORT_IN_PROGRESS. The file holds no more than the report shows that person (their record scope is fixed when they ask). The request is audited.',
  })
  requestExport(@Body(zodPipe(requestRevenueExportSchema)) body: RequestRevenueExport) {
    return this.exports.request(body);
  }

  @Get('exports')
  @RequirePermission(REVENUE_PERMISSIONS.export)
  @ApiOperation({ summary: 'The latest files prepared for the caller, newest first' })
  listExports() {
    return this.exports.list();
  }

  @Get('exports/:id/download')
  @RequirePermission(REVENUE_PERMISSIONS.export)
  @Throttle({ limit: 20, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'The finished file (kept 7 days); only the person who asked can download it',
  })
  async downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, contentType } = await this.exports.download(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }
}

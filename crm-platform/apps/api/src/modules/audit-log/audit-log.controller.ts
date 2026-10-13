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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  auditLogFacetsQuerySchema,
  auditLogQuerySchema,
  requestAuditLogExportSchema,
  type AuditLogFacetsQuery,
  type AuditLogQuery,
  type RequestAuditLogExport,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { AuditLogExportService } from './audit-log-export.service';
import { AuditLogService } from './audit-log.service';

/**
 * The workspace audit log (spec docs/specs/audit-log-tenant.md): who changed what, when, from what to what. Staff only. Read needs
 * `audit.log.read`, the CSV `audit.log.export` (Owner and Admin by default; Manager has neither). Literal paths come before `:id`.
 */
@ApiTags('audit-log')
@ActorKinds('user')
@Controller({ path: 'audit-log', version: '2' })
export class AuditLogController {
  constructor(
    private readonly log: AuditLogService,
    private readonly exports: AuditLogExportService,
  ) {}

  @Get()
  @RequirePermission('audit.log.read')
  @Throttle({ limit: 120, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Audit entries of the workspace, newest first (cursor paginated, bounded by a time window)',
    description:
      'Filters: from / to (default the last 30 days, at most 400), actorId, actorType, module, action, recordId, requestId, q (module and action only), actAs. Carries field names, never values.',
  })
  list(@Query(zodPipe(auditLogQuerySchema)) query: AuditLogQuery) {
    return this.log.list(query);
  }

  @Get('settings')
  @RequirePermission('audit.log.read')
  @ApiOperation({ summary: 'Retention in days and what the viewer may do (export, see personal values)' })
  settings() {
    return this.log.settings();
  }

  @Get('facets')
  @RequirePermission('audit.log.read')
  @ApiOperation({ summary: 'The modules and actions present in the window (for the filters)' })
  facets(@Query(zodPipe(auditLogFacetsQuerySchema)) query: AuditLogFacetsQuery) {
    return this.log.facets(query);
  }

  @Post('exports')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('audit.log.export')
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Prepare a CSV of the filtered window in the background; announced by email (202)',
    description:
      'One at a time per workspace: 409 AUDIT_EXPORT_IN_PROGRESS. Values are masked in the file whoever asks. The request is audited.',
  })
  requestExport(@Body(zodPipe(requestAuditLogExportSchema)) body: RequestAuditLogExport) {
    return this.exports.request(body);
  }

  @Get('exports')
  @RequirePermission('audit.log.export')
  @ApiOperation({ summary: 'The latest prepared exports, newest first' })
  listExports() {
    return this.exports.list();
  }

  @Get('exports/:id/download')
  @RequirePermission('audit.log.export')
  @Throttle({ limit: 20, windowSeconds: 60, by: 'actor' })
  @ApiOperation({ summary: 'The finished export as CSV (kept 7 days)' })
  async downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.exports.download(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }

  @Get(':id')
  @RequirePermission('audit.log.read')
  @Throttle({ limit: 120, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'One entry with its field changes (old to new), personal values masked',
    description:
      'Writes an `audit-log` / `read` entry (who opened which entry). Personal values are masked unless the viewer holds the Owner key; secrets are never shown.',
  })
  detail(@Param('id') id: string) {
    return this.log.detail(id);
  }
}

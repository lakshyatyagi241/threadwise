import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { uploadReportDocumentFieldsSchema, type UploadReportDocumentFields } from '@crm/contracts';
import { ActorKinds, Idempotent } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { reportUpload, runtimeRest } from './report-copilot.controller';
import { ReportAiService } from './report-ai.service';
import {
  ReportDocumentsService,
  type UploadedFile as UploadedFileShape,
} from './report-documents.service';
import { ReportFileTooLargeInterceptor } from './report-file-too-large.interceptor';
import { ReportRuntimeService } from './report-runtime.service';

/**
 * The AI report assistant on the platform operator's Overview. Its documents live in `platform_report_documents`, and its numbers are the
 * platform's own (every workspace's income and usage), so like the revenue reports it is for super admins and the read-only auditor; a
 * support operator is refused. Adding and removing documents is for super admins only.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin', 'auditor')
@Controller({ path: 'platform/report-copilot', version: '2' })
export class PlatformReportCopilotController {
  constructor(
    private readonly documents: ReportDocumentsService,
    private readonly ai: ReportAiService,
    private readonly runtime: ReportRuntimeService,
  ) {}

  @Get('documents')
  @ApiOperation({ summary: "The platform's report documents (newest first) and the library limit" })
  list() {
    return this.documents.list('platform');
  }

  @Post('documents')
  @Idempotent()
  @OperatorRoles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(ReportFileTooLargeInterceptor, reportUpload)
  @ApiOperation({
    summary: 'Add a document to the platform library (super admin)',
    description: 'Multipart: `file` and an optional `name`. Same types and limits as a workspace.',
  })
  upload(
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body(zodPipe(uploadReportDocumentFieldsSchema)) fields: UploadReportDocumentFields,
  ) {
    return this.documents.upload('platform', file, fields);
  }

  @Delete('documents/:id')
  @OperatorRoles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document from the platform library (super admin)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documents.remove('platform', id);
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether the assistant can answer now, and if not why' })
  status() {
    return this.ai.status('platform');
  }

  @All('runtime/*path')
  @ApiExcludeEndpoint()
  async runtimeRoute(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.runtime.handle('platform', req, res, runtimeRest(req));
  }
}

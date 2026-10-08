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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  REPORT_DOCUMENT_LIMITS,
  uploadReportDocumentFieldsSchema,
  type UploadReportDocumentFields,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportAiService } from './report-ai.service';
import {
  ReportDocumentsService,
  type UploadedFile as UploadedFileShape,
} from './report-documents.service';
import { ReportFileTooLargeInterceptor } from './report-file-too-large.interceptor';
import { ReportRuntimeService } from './report-runtime.service';

export const reportUpload = FileInterceptor('file', {
  limits: { fileSize: REPORT_DOCUMENT_LIMITS.fileBytes, files: 1, fields: 4 },
});

/** The part of the path after `/runtime` (the runtime's own routes: `/info`, `/agent/default/run`, ...). */
export const runtimeRest = (req: Request): string => /\/runtime(\/.*)?$/.exec(req.path)?.[1] ?? '/';

/**
 * The AI report assistant on the workspace Dashboard: the documents people add for reports, and the CopilotKit runtime the chat talks to.
 * `dash.reports.read` lists the documents and opens the chat; `dash.reports.manage` adds and removes documents.
 */
@ApiTags('report-copilot')
@ActorKinds('user')
@Controller({ path: 'report-copilot', version: '2' })
export class ReportCopilotController {
  constructor(
    private readonly documents: ReportDocumentsService,
    private readonly ai: ReportAiService,
    private readonly runtime: ReportRuntimeService,
  ) {}

  @Get('documents')
  @RequirePermission('dash.reports.read')
  @ApiOperation({
    summary: "The workspace's report documents (newest first) and the library limit",
  })
  list() {
    return this.documents.list('workspace');
  }

  @Post('documents')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('dash.reports.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(ReportFileTooLargeInterceptor, reportUpload)
  @ApiOperation({
    summary:
      'Add a document (PDF, DOCX, TXT, Markdown, CSV, HTML, JSON; up to 10 MB); its text is kept for the assistant',
    description:
      'Multipart: `file` and an optional `name`. A file that cannot be read or holds no text is a 422 problem and nothing is stored.',
  })
  upload(
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body(zodPipe(uploadReportDocumentFieldsSchema)) fields: UploadReportDocumentFields,
  ) {
    return this.documents.upload('workspace', file, fields);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dash.reports.manage')
  @ApiOperation({ summary: 'Remove a document' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documents.remove('workspace', id);
  }

  @Get('status')
  @RequirePermission('dash.reports.read')
  @ApiOperation({
    summary:
      'Whether the assistant can answer now, and if not why (no AI key, unsupported vendor, allowance used)',
  })
  status() {
    return this.ai.status('workspace');
  }

  // The CopilotKit runtime (server-sent events). Not part of the OpenAPI document: its protocol is CopilotKit's, not ours.
  @All('runtime/*path')
  @RequirePermission('dash.reports.read')
  @ApiExcludeEndpoint()
  async runtimeRoute(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.runtime.handle('workspace', req, res, runtimeRest(req));
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  IMPORT_MAX_BYTES,
  contactImportOptionsSchema,
  listImportJobsQuerySchema,
  type ContactImportOptions,
  type ListImportJobsQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactImportService, sampleCsv, type UploadedCsv } from './contact-import.service';
import { UTF8_BOM } from '../contact-bulk/csv-writer';

const upload = FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } });

/** The `options` field of the multipart form: a JSON string, validated with the contract schema. */
function parseOptions(raw: unknown): ContactImportOptions {
  let value: unknown = {};
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw AppError.validation('options must be a JSON object');
    }
  }
  const parsed = contactImportOptionsSchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.validation(
      'Invalid import options',
      parsed.error.issues.map((i) => ({ path: `options.${i.path.join('.')}`, message: i.message })),
    );
  }
  return parsed.data;
}

/**
 * CSV import (WD-CON-027..032). Registered before ContactsController so the literal
 * `contacts/import/...` paths are never read as a contact id.
 */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts/import', version: '2' })
export class ContactImportController {
  constructor(private readonly imports: ContactImportService) {}

  @Get('sample')
  @RequirePermission('record.contacts.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts-sample.csv"')
  @ApiOperation({ summary: 'A sample CSV in the importer format' })
  sample(): string {
    return sampleCsv();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.import')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Preview an import: columns detected, sample rows, what would be created or updated',
    description:
      'Form fields: `file` (the CSV) and optionally `options` (JSON: mapping, delimiter, defaultCountryCode, ...). Writes nothing.',
  })
  async preview(@UploadedFile() file: UploadedCsv | undefined, @Body() body: { options?: string }) {
    return this.imports.preview(file, parseOptions(body?.options));
  }

  @Post()
  @RequirePermission('record.contacts.import')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import contacts from a CSV',
    description:
      'Up to 1,000 rows run inside the request (200 with the finished job). Larger files are queued (202); poll GET /contacts/import/jobs/:id. Form fields: `file`, and optionally `options` (JSON: mapping, status, source, groupId, tagIds, defaultCountryCode, triggerAutomations).',
  })
  async start(
    @UploadedFile() file: UploadedCsv | undefined,
    @Body() body: { options?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { job, queued } = await this.imports.start(file, parseOptions(body?.options));
    res.status(queued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return job;
  }

  @Get('jobs')
  @RequirePermission('record.contacts.import')
  @ApiOperation({ summary: 'Recent imports, newest first' })
  async list(@Query(zodPipe(listImportJobsQuerySchema)) query: ListImportJobsQuery) {
    return this.imports.listJobs(query);
  }

  @Get('jobs/:id')
  @RequirePermission('record.contacts.import')
  @ApiOperation({ summary: 'One import: status, progress and the counted result' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getJob(id);
  }

  @Get('jobs/:id/rejects')
  @RequirePermission('record.contacts.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts-import-rejects.csv"')
  @ApiOperation({ summary: 'The rows that were not imported, with the reason, as a CSV' })
  async rejects(@Param('id', ParseUUIDPipe) id: string): Promise<string> {
    return UTF8_BOM + (await this.imports.rejectsCsv(id));
  }
}

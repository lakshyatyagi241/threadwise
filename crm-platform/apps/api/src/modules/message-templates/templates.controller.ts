import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTemplateInputSchema,
  lintTemplateInputSchema,
  listTemplatesQuerySchema,
  syncTemplatesInputSchema,
  updateTemplateInputSchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type ListTemplatesQuery,
  type SyncTemplatesInput,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TemplateSyncService } from './template-sync.service';
import { MEDIA_UPLOAD_MAX_BYTES, TemplatesService } from './templates.service';

/**
 * WhatsApp message templates (TPL): the library, authoring, and the conversation with Meta.
 *
 * Seeing the library, authoring, deleting, and anything that talks to Meta are four separate capabilities. Saving a draft
 * needs `tpl.templates.create`; sending it to Meta (create or edit with `submit`, retry, refresh, sync) also needs
 * `tpl.templates.sync`.
 */
@ApiTags('message-templates')
@ActorKinds('user')
@Controller({ path: 'templates', version: '2' })
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly sync: TemplateSyncService,
  ) {}

  @Get()
  @RequirePermission('tpl.templates.read')
  @ApiOperation({ summary: 'List templates (cursor paginated, newest first)' })
  async list(@Query(zodPipe(listTemplatesQuerySchema)) query: ListTemplatesQuery) {
    return this.templates.list(query);
  }

  // Literal routes first: ':id' would otherwise take them for an id.

  @Post('lint')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tpl.templates.create')
  @ApiOperation({ summary: 'Check a template the way Meta would, without saving it' })
  lint(@Body(zodPipe(lintTemplateInputSchema)) body: LintTemplateInput) {
    return this.templates.lint(body);
  }

  @Post('media')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tpl.templates.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MEDIA_UPLOAD_MAX_BYTES, files: 1 } }),
  )
  @ApiOperation({
    summary: 'Upload a header example (image, video or PDF) to Meta; returns its handle',
  })
  async uploadMedia(
    @Body(zodPipe(syncTemplatesInputSchema)) body: SyncTemplatesInput,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
  ) {
    return this.templates.uploadMedia(body.connectionId, file);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('tpl.templates.sync')
  @ApiOperation({ summary: 'Pull every template of one WhatsApp number from Meta' })
  async syncFromMeta(@Body(zodPipe(syncTemplatesInputSchema)) body: SyncTemplatesInput) {
    return this.sync.sync(body);
  }

  @Get(':id')
  @RequirePermission('tpl.templates.read')
  @ApiOperation({ summary: 'One template with the Meta payload it produces and its lint result' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('tpl.templates.create')
  @ApiOperation({
    summary: 'Create a template and (by default) send it to Meta',
    description:
      'A lint error stops everything with TPL_LINT_FAILED and nothing is saved or sent. If Meta refuses, the template is kept and `metaError` carries its reason.',
  })
  async create(@Body(zodPipe(createTemplateInputSchema)) body: CreateTemplateInput) {
    return this.templates.create(body);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('tpl.templates.create')
  @ApiOperation({
    summary: 'Edit a template that is pending, rejected or a draft',
    description:
      'With `submit`, the copy on Meta is deleted by name and created again (Meta has no in-place edit for a template under review).',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTemplateInputSchema)) body: UpdateTemplateInput,
  ) {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('tpl.templates.delete')
  @ApiOperation({
    summary: 'Delete a template here and on Meta (refused while a broadcast uses it)',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.templates.remove(id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('tpl.templates.sync')
  @ApiOperation({ summary: 'Send a saved template to Meta, or retry after a refusal' })
  async submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.submit(id);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tpl.templates.sync')
  @ApiOperation({ summary: "Re-read this template's status and quality from Meta" })
  async refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.refresh(id);
  }
}

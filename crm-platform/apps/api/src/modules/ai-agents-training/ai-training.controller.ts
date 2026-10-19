import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AIAG_SOURCE_LIMITS,
  addAiagSourceSchema,
  createAiagAssistantSchema,
  listAiagAssistantsQuerySchema,
  saveAiagResponderSchema,
  updateAiagAssistantSchema,
  uploadAiagSourceFieldsSchema,
  type AddAiagSourceInput,
  type CreateAiagAssistantInput,
  type ListAiagAssistantsQuery,
  type SaveAiagResponderInput,
  type UpdateAiagAssistantInput,
  type UploadAiagSourceFields,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { AssistantsService } from './assistants.service';
import { ResponderService } from './responder.service';
import { SourcesService, type UploadedFile as UploadedFileShape } from './sources.service';
import { TrainingFileTooLargeInterceptor } from './training-file-too-large.interceptor';

const upload = FileInterceptor('file', {
  limits: { fileSize: AIAG_SOURCE_LIMITS.fileBytes, files: 1, fields: 8 },
});

/**
 * AI Training (AIAG): the trained chat assistants of the workspace, their knowledge entries and the responder mode.
 * The whole surface needs the plan's `ai_assistants` feature (Reference gated the group on it; its page-only paywall let the
 * JSON endpoints answer anyway, here a read is refused too, and the web draws the upgrade sheet from the 422).
 */
@ApiTags('ai-training')
@ActorKinds('user')
@RequirePlanFeature('ai_assistants')
@Controller({ path: 'ai-training', version: '2' })
export class AiTrainingController {
  constructor(
    private readonly assistants: AssistantsService,
    private readonly sources: SourcesService,
    private readonly responder: ResponderService,
  ) {}

  @Get('assistants')
  @RequirePermission('aiag.training.read')
  @ApiOperation({
    summary: 'The assistants (newest first) with the workspace stat numbers',
    description: 'Cursor pages of 20 by default.',
  })
  list(@Query(zodPipe(listAiagAssistantsQuerySchema)) query: ListAiagAssistantsQuery) {
    return this.assistants.list(query);
  }

  @Get('assistants/picker')
  @RequirePermission('aiag.training.read')
  @ApiOperation({ summary: 'Active assistants by name with their ready entry counts (pickers)' })
  picker() {
    return this.assistants.picker();
  }

  @Get('assistants/:id')
  @RequirePermission('aiag.training.read')
  @ApiOperation({ summary: 'One assistant, as the builder edits it' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.assistants.get(id);
  }

  @Post('assistants')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('aiag.training.create')
  @ApiOperation({
    summary: 'Create an assistant; the slug is made from the name and is unique in the workspace',
  })
  create(@Body(zodPipe(createAiagAssistantSchema)) body: CreateAiagAssistantInput) {
    return this.assistants.create(body);
  }

  @Patch('assistants/:id')
  @RequirePermission('aiag.training.update')
  @ApiOperation({
    summary: 'Save an assistant (the form plus the row version it was read at)',
    description:
      'A stale `rowVersion` is refused with 409 ROW_VERSION_CONFLICT. An id that is not in this workspace is a 404 (Reference created a new assistant instead).',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateAiagAssistantSchema)) body: UpdateAiagAssistantInput,
  ) {
    return this.assistants.update(id, body);
  }

  @Post('assistants/:id/duplicate')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('aiag.training.create')
  @ApiOperation({ summary: 'Copy an assistant and its entries, named "<name> (copy)", paused' })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.assistants.duplicate(id);
  }

  @Delete('assistants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('aiag.training.delete')
  @ApiOperation({ summary: 'Delete an assistant with its entries and their stored files' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.assistants.remove(id);
  }

  @Get('assistants/:id/sources')
  @RequirePermission('aiag.training.read')
  @ApiOperation({
    summary: "The assistant's own knowledge entries (newest first)",
  })
  listSources(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.list(id);
  }

  @Post('assistants/:id/sources')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('aiag.training.update')
  @ApiOperation({
    summary: 'Add a URL, pasted text or a Q&A pair',
    description:
      'Text and Q&A are `ready` at once. A URL answers `processing` and is read by the worker; poll the list for `ready` or `failed`.',
  })
  addSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addAiagSourceSchema)) body: AddAiagSourceInput,
  ) {
    return this.sources.add(id, body);
  }

  @Post('assistants/:id/sources/file')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('aiag.training.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(TrainingFileTooLargeInterceptor, upload)
  @ApiOperation({
    summary:
      'Upload a file (TXT, Markdown, CSV, HTML, PDF, DOCX; up to 10 MB); its text becomes the entry',
    description: 'Multipart: `file` and `label`.',
  })
  uploadSource(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body(zodPipe(uploadAiagSourceFieldsSchema)) fields: UploadAiagSourceFields,
  ) {
    return this.sources.upload(id, file, fields);
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('aiag.training.update')
  @ApiOperation({ summary: 'Remove a knowledge entry and its stored file' })
  async removeSource(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sources.remove(id);
  }

  @Get('responder')
  @RequirePermission('aiag.training.read')
  @ApiOperation({
    summary: 'Who answers the workspace WhatsApp: the mode and the Meta agent switch',
  })
  getResponder() {
    return this.responder.get();
  }

  @Put('responder')
  @RequirePermission('aiag.responder.manage')
  @ApiOperation({ summary: 'Choose who answers the workspace WhatsApp' })
  saveResponder(@Body(zodPipe(saveAiagResponderSchema)) body: SaveAiagResponderInput) {
    return this.responder.save(body);
  }
}

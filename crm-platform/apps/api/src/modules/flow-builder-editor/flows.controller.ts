import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  FLB_AI_PROVIDERS,
  ERROR_CODES,
  FLB_GOOGLE_PICKER_KINDS,
  flbAiGenerateRequestSchema,
  flbCommerceProductsQuerySchema,
  importFlowRequestSchema,
  listFlowsQuerySchema,
  renameFlowRequestSchema,
  saveFlowRequestSchema,
  flbTestWebhookRequestSchema,
  updateFlowRequestSchema,
  uuidSchema,
  type FlbAiGenerateRequest,
  type FlbCommerceProductsQuery,
  type ImportFlowRequest,
  type ListFlowsQuery,
  type RenameFlowRequest,
  type SaveFlowRequest,
  type FlbTestWebhookRequest,
  type UpdateFlowRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BuilderContextService } from './builder-context.service';
import { FlowAiService } from './flow-ai.service';
import { FLOW_MEDIA_MAX_BYTES, FLOW_MEDIA_TYPES, FlowMediaService } from './flow-media.service';
import { FlowsService } from './flows.service';
import { TestWebhookService } from './test-webhook.service';

const uploadTypeSchema = z.enum(FLOW_MEDIA_TYPES);
const googleKindSchema = z.enum(FLB_GOOGLE_PICKER_KINDS);
const upload = FileInterceptor('file', {
  limits: { fileSize: FLOW_MEDIA_MAX_BYTES, files: 1 },
});

/**
 * Flows (TW-FLB-001..029). Literal paths are declared before `:id`: Express matches in registration order, and
 * `POST import` would otherwise be read as `:id` with the id "import".
 */
@ApiTags('flows')
@ActorKinds('user')
@Controller({ path: 'flows', version: '2' })
export class FlowsController {
  constructor(
    private readonly flows: FlowsService,
    private readonly context: BuilderContextService,
    private readonly ai: FlowAiService,
    private readonly webhook: TestWebhookService,
    private readonly media: FlowMediaService,
  ) {}

  @Get()
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'List flows (cursor paginated, newest updated first)',
    description:
      'Filters: status (all | live | paused | draft), category (exact), q (case-insensitive substring of the name). `includeTotal` adds the filtered total.',
  })
  async list(@Query(zodPipe(listFlowsQuerySchema)) query: ListFlowsQuery) {
    return this.flows.list(query);
  }

  @Get('overview')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'KPI tiles, library and status rails, the featured card and the template gallery',
    description: 'Counts ignore the list filters.',
  })
  async overview() {
    return this.flows.overview();
  }

  @Get('templates')
  @RequirePermission('flb.flows.read')
  @ApiOperation({ summary: 'Active starter templates (the "Start from a template" gallery)' })
  async templates() {
    return this.flows.templates();
  }

  @Post('templates/:id/clone')
  @Idempotent()
  @RequirePermission('flb.flows.create')
  @ApiOperation({
    summary: 'Clone a template into a new unpublished flow',
    description: 'Counts against the plan flow cap (422 PLAN_LIMIT_REACHED). A hidden or deleted template is 404.',
  })
  async cloneTemplate(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.cloneTemplate(id);
  }

  @Get('builder-context')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'Everything the builder needs to fill its dropdowns, in one call',
    description:
      'Channels the workspace can run, senders per channel (`<engine>:<uuid>` keys), tags, groups, teams, agents, stages, approved templates, flows, AI models and assistants, booking types, forms and commerce stores.',
  })
  async builderContext() {
    return this.context.context();
  }

  @Get('builder-context/commerce-products')
  @RequirePermission('flb.flows.read')
  @ApiOperation({ summary: 'Products a commerce node can offer' })
  async commerceProducts(
    @Query(zodPipe(flbCommerceProductsQuerySchema)) query: FlbCommerceProductsQuery,
  ) {
    return this.context.commerceProducts(query);
  }

  @Get('builder-context/google/:kind')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'Google Sheets / Docs / Forms files for the node pickers',
    description:
      '503 FLB_INTEGRATION_DISABLED while the Google integration is not connected on this deployment.',
  })
  async google(@Param('kind', zodPipe(googleKindSchema)) _kind: z.infer<typeof googleKindSchema>) {
    throw new AppError(
      ERROR_CODES.FLB_INTEGRATION_DISABLED,
      'Google integration is not connected.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  @Post('import')
  @Idempotent()
  @RequirePermission('flb.flows.create')
  @ApiOperation({
    summary: 'Import an export file (or a bare graph) as a new unpublished flow "<name> (imported)"',
    description: '422 FLB_IMPORT_INVALID when there is no flowNodes array; 422 PLAN_LIMIT_REACHED at the plan cap.',
  })
  async importFlow(@Body(zodPipe(importFlowRequestSchema)) body: ImportFlowRequest) {
    return this.flows.importFlow(body);
  }

  @Post('test-webhook')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flb.flows.update')
  @ApiOperation({
    summary: 'Fire a Webhook node for real from the Test runner (SSRF guarded)',
    description:
      'Failures are 200 `{ok:false,error}` so the chat log can show them: no URL, `Blocked: <reason>` (private, reserved or metadata hosts, redirects), `Request failed: ...`.',
  })
  async testWebhook(@Body(zodPipe(flbTestWebhookRequestSchema)) body: FlbTestWebhookRequest) {
    return this.webhook.run(body);
  }

  @Post('ai-generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flb.flows.update')
  @ApiOperation({
    summary: 'Generate a flow graph from a prompt',
    description: `Providers: ${FLB_AI_PROVIDERS.join(', ')}. At most 20 nodes and 40 edges come back. 422 FLB_AI_NO_KEY, 502 FLB_AI_PROVIDER_FAILED, 422 FLB_AI_BAD_JSON.`,
  })
  async aiGenerate(@Body(zodPipe(flbAiGenerateRequestSchema)) body: FlbAiGenerateRequest) {
    return this.ai.generate(body);
  }

  @Post('upload-media')
  @RequirePermission('flb.flows.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  @ApiOperation({
    summary: 'Upload an image, video, audio or document for a Media / Sequence node (up to 50 MB)',
    description: 'The type and content are checked by the shared upload guard; the stored name is server generated.',
  })
  async uploadMedia(
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Body('type') rawType: unknown,
  ) {
    if (!file) {
      throw AppError.validation('Choose a file to upload', [{ path: 'file', message: 'Required.' }]);
    }
    const type = uploadTypeSchema.safeParse(rawType);
    if (!type.success) {
      throw AppError.validation('Invalid upload type', [{ path: 'type', message: 'Use image, video, audio or document.' }]);
    }
    return { data: await this.media.upload(file, type.data, await this.media.orgUuid()) };
  }

  @Post()
  @Idempotent()
  @RequirePermission('flb.flows.create')
  @ApiOperation({
    summary: 'Save a new flow (an unpublished draft)',
    description: 'The plan flow cap applies here and on import / clone / duplicate; editing never counts.',
  })
  async create(@Body(zodPipe(saveFlowRequestSchema)) body: SaveFlowRequest) {
    return this.flows.create(body);
  }

  @Get(':id')
  @RequirePermission('flb.flows.read')
  @ApiOperation({ summary: 'One flow with its graph' })
  async one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.get(id);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('flb.flows.update')
  @ApiOperation({
    summary: 'Save the graph, name, category and channel of a flow',
    description: 'Needs the current `rowVersion` (409 ROW_VERSION_CONFLICT when someone saved first). Re-derives the trigger columns.',
  })
  async save(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateFlowRequestSchema)) body: UpdateFlowRequest,
  ) {
    return this.flows.save(id, body);
  }

  @Patch(':id/rename')
  @Idempotent()
  @RequirePermission('flb.flows.update')
  @ApiOperation({ summary: 'Rename a flow (up to 191 characters)' })
  async rename(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(renameFlowRequestSchema)) body: RenameFlowRequest,
  ) {
    return this.flows.rename(id, body.name);
  }

  @Post(':id/toggle')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('flb.flows.update')
  @ApiOperation({ summary: 'Pause or resume a flow (flips is_active)' })
  async toggle(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.toggle(id);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('flb.flows.create')
  @ApiOperation({ summary: 'Copy a flow as an unpublished draft "<name> (Copy)"' })
  async duplicate(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.duplicate(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('flb.flows.publish')
  @ApiOperation({ summary: 'Publish a saved flow' })
  async publish(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.publish(id);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('flb.flows.publish')
  @ApiOperation({ summary: 'Return a flow to draft' })
  async unpublish(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.flows.unpublish(id);
  }

  @Get(':id/export')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'The portable export file of a flow',
    description: 'Graph verbatim under the `_threadwise_flow_export` marker, no workspace or user ids.',
  })
  async exportFlow(@Param('id', zodPipe(uuidSchema)) id: string) {
    return (await this.flows.export(id)).file;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('flb.flows.delete')
  @ApiOperation({ summary: 'Delete a flow (its subscribers go with it)' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.flows.remove(id);
  }
}

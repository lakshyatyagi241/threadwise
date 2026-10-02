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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLostReasonSchema,
  createPipelineSchema,
  createStageSchema,
  deletePipelineQuerySchema,
  deleteStageQuerySchema,
  reorderLostReasonsSchema,
  reorderPipelinesSchema,
  reorderStagesSchema,
  updateDealSettingsSchema,
  updateLostReasonSchema,
  updatePipelineSchema,
  updateStageSchema,
  type CreateLostReasonInput,
  type CreatePipelineInput,
  type CreateStageInput,
  type DeletePipelineQuery,
  type DeleteStageQuery,
  type ReorderLostReasonsInput,
  type ReorderPipelinesInput,
  type ReorderStagesInput,
  type UpdateDealSettingsInput,
  type UpdateLostReasonInput,
  type UpdatePipelineInput,
  type UpdateStageInput,
} from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { LostReasonsService } from './lost-reasons.service';
import { PipelinesService } from './pipelines.service';

/** Pipelines and their stages: the editor (TW-DEAL-041, 042). Reading needs `record.pipelines.read`, the rest the matching key. */
@ApiTags('pipelines')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'pipelines', version: '2' })
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermission('record.pipelines.read')
  @ApiOperation({ summary: 'List the pipelines with their stages, in order' })
  async list() {
    return this.pipelines.list();
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.pipelines.create')
  @ApiOperation({
    summary: 'Create a pipeline',
    description:
      'Omit `stages` for the standard six. At most one won and one lost stage. Over the plan cap is 422 PLAN_LIMIT_REACHED.',
  })
  async create(@Body(zodPipe(createPipelineSchema)) body: CreatePipelineInput) {
    return this.pipelines.create(body);
  }

  // Literal routes before ':id', or Express reads "order" as an id.
  @Put('order')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({ summary: 'Reorder the pipelines (send every id once)' })
  async reorder(@Body(zodPipe(reorderPipelinesSchema)) body: ReorderPipelinesInput) {
    return this.pipelines.reorder(body);
  }

  @Get(':id')
  @RequirePermission('record.pipelines.read')
  @ApiOperation({ summary: 'Get one pipeline with its stages' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pipelines.get(id);
  }

  @Patch(':id')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({
    summary: 'Rename a pipeline, change its currency or make it the default',
    description: 'Requires the rowVersion you read. Existing deals keep their own currency.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updatePipelineSchema)) body: UpdatePipelineInput,
  ) {
    return this.pipelines.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.pipelines.delete')
  @ApiOperation({
    summary: 'Delete a pipeline',
    description:
      'The default pipeline is refused (409 DEAL_PIPELINE_DEFAULT_PROTECTED). With deals, `moveDealsToPipelineId` is required (409 DEAL_PIPELINE_HAS_DEALS).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(deletePipelineQuerySchema)) query: DeletePipelineQuery,
  ): Promise<void> {
    await this.pipelines.remove(id, query);
  }

  @Post(':id/stages')
  @Idempotent()
  @RequirePermission('record.pipelines.update')
  @ApiOperation({ summary: 'Add a stage to a pipeline' })
  async createStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createStageSchema)) body: CreateStageInput,
  ) {
    return this.pipelines.createStage(id, body);
  }

  @Put(':id/stages/order')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({ summary: "Reorder a pipeline's stages (send every stage id once)" })
  async reorderStages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reorderStagesSchema)) body: ReorderStagesInput,
  ) {
    return this.pipelines.reorderStages(id, body);
  }
}

@ApiTags('pipelines')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'pipeline-stages', version: '2' })
export class PipelineStagesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Patch(':id')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({
    summary: 'Rename, recolour, set the probability of, or change the kind of a stage',
    description:
      'Requires the rowVersion you read. A won stage is always 100% and a lost stage 0%. Only an empty stage can change kind.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStageSchema)) body: UpdateStageInput,
  ) {
    return this.pipelines.updateStage(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.pipelines.delete')
  @ApiOperation({
    summary: 'Delete a stage',
    description:
      'A stage with deals needs `moveDealsToStageId` (a stage of the same pipeline): 409 DEAL_STAGE_HAS_DEALS otherwise. The last stage cannot be deleted.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(deleteStageQuerySchema)) query: DeleteStageQuery,
  ): Promise<void> {
    await this.pipelines.removeStage(id, query);
  }
}

const listReasonsQuerySchema = z.object({
  /** `true` for the reasons a picker may offer. */
  activeOnly: z
    .preprocess(
      (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
      z.boolean(),
    )
    .optional(),
});

/** The lost-reason catalogue (TW-DEAL-043). */
@ApiTags('pipelines')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deal-lost-reasons', version: '2' })
export class LostReasonsController {
  constructor(private readonly reasons: LostReasonsService) {}

  @Get()
  @RequirePermission('record.pipelines.read')
  @ApiOperation({ summary: 'List lost reasons in order (activeOnly=true for a picker)' })
  async list(
    @Query(zodPipe(listReasonsQuerySchema)) query: z.infer<typeof listReasonsQuerySchema>,
  ) {
    return this.reasons.list(query.activeOnly ?? false);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.pipelines.create')
  @ApiOperation({ summary: 'Add a lost reason' })
  async create(@Body(zodPipe(createLostReasonSchema)) body: CreateLostReasonInput) {
    return this.reasons.create(body);
  }

  @Put('order')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({ summary: 'Reorder the lost reasons (send every id once)' })
  async reorder(@Body(zodPipe(reorderLostReasonsSchema)) body: ReorderLostReasonsInput) {
    return this.reasons.reorder(body);
  }

  @Patch(':id')
  @RequirePermission('record.pipelines.update')
  @ApiOperation({
    summary: 'Rename or (de)activate a lost reason',
    description: 'Requires the rowVersion you read.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateLostReasonSchema)) body: UpdateLostReasonInput,
  ) {
    return this.reasons.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.pipelines.delete')
  @ApiOperation({ summary: 'Delete a lost reason; deals keep the reason text' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.reasons.remove(id);
  }
}

@ApiTags('pipelines')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deal-settings', version: '2' })
export class DealSettingsController {
  constructor(private readonly reasons: LostReasonsService) {}

  @Get()
  @RequirePermission('record.pipelines.read')
  @ApiOperation({ summary: 'Workspace deal settings (whether a lost reason is required)' })
  async get() {
    return this.reasons.settings();
  }

  @Put()
  @RequirePermission('record.pipelines.update')
  @ApiOperation({ summary: 'Change the workspace deal settings' })
  async update(@Body(zodPipe(updateDealSettingsSchema)) body: UpdateDealSettingsInput) {
    return this.reasons.updateSettings(body);
  }
}

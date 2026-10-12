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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addFaqVariationsSchema,
  bulkFaqEntriesSchema,
  createFaqEntrySchema,
  faqInsightsQuerySchema,
  generateFaqVariationsSchema,
  learnFaqLogSchema,
  listFaqEntriesQuerySchema,
  listFaqLogQuerySchema,
  testFaqQuerySchema,
  updateFaqEntrySchema,
  updateFaqSettingsSchema,
  updateFaqVariationSchema,
  type AddFaqVariationsInput,
  type BulkFaqEntriesInput,
  type CreateFaqEntryInput,
  type FaqInsightsQuery,
  type GenerateFaqVariationsInput,
  type LearnFaqLogInput,
  type ListFaqEntriesQuery,
  type ListFaqLogQuery,
  type TestFaqQueryInput,
  type UpdateFaqEntryInput,
  type UpdateFaqSettingsInput,
  type UpdateFaqVariationInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FaqGenerateService } from './faq-generate.service';
import { FaqInsightsService } from './faq-insights.service';
import { FaqSettingsService } from './faq-settings.service';
import { FaqService } from './faq.service';

/**
 * The FAQ knowledge base of a flow (ADR-0021, addendum 2): the flow's FAQs and their variations, a playground that shows how a message
 * would be matched, the flow's match log and what to learn from it, and the flow's switch and matching knobs. Every route is scoped
 * by `:flowId` (the flow's public id); a flow of another workspace is 404.
 */
@ApiTags('faq')
@ActorKinds('user')
@Controller({ path: 'faq', version: '2' })
export class FaqController {
  constructor(
    private readonly faqs: FaqService,
    private readonly generate: FaqGenerateService,
    private readonly insights: FaqInsightsService,
    private readonly settings: FaqSettingsService,
  ) {}

  // --- entries ------------------------------------------------------------------------------------------------------

  @Get('flows/:flowId/entries')
  @RequirePermission('faq.entries.read')
  @ApiOperation({
    summary: "The flow's FAQs (newest first) with the flow's counts",
    description: 'Cursor pages of 20 by default.',
  })
  list(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Query(zodPipe(listFaqEntriesQuerySchema)) query: ListFaqEntriesQuery,
  ) {
    return this.faqs.list(flowId, query);
  }

  @Post('flows/:flowId/entries')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Add an FAQ with its answer (a text, or a flow to start) and optional variations',
  })
  create(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Body(zodPipe(createFaqEntrySchema)) body: CreateFaqEntryInput,
  ) {
    return this.faqs.create(flowId, body);
  }

  @Post('flows/:flowId/entries/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary: 'Pause, activate or delete many FAQs at once (delete also needs faq.entries.delete)',
  })
  bulk(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Body(zodPipe(bulkFaqEntriesSchema)) body: BulkFaqEntriesInput,
  ) {
    return this.faqs.bulk(flowId, body);
  }

  @Get('flows/:flowId/entries/:id')
  @RequirePermission('faq.entries.read')
  @ApiOperation({ summary: 'One FAQ with every variation and its indexing state' })
  get(@Param('flowId', ParseUUIDPipe) flowId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.faqs.get(flowId, id);
  }

  @Patch('flows/:flowId/entries/:id')
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary: 'Save an FAQ (the form plus the row version it was read at)',
    description:
      'A stale `rowVersion` is refused with 409 ROW_VERSION_CONFLICT; a question another FAQ already has with 409 FAQ_DUPLICATE_QUESTION.',
  })
  update(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFaqEntrySchema)) body: UpdateFaqEntryInput,
  ) {
    return this.faqs.update(flowId, id, body);
  }

  @Get('flow-nodes/:flowId')
  @RequirePermission('faq.entries.read')
  @ApiOperation({
    summary: 'The steps of one of the workspace\'s flows, for the "start at this step" picker',
  })
  flowNodes(@Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.faqs.flowNodes(flowId);
  }

  @Delete('flows/:flowId/entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.delete')
  @ApiOperation({ summary: 'Delete an FAQ and its variations' })
  async remove(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.faqs.remove(flowId, id);
  }

  // --- variations ---------------------------------------------------------------------------------------------------

  @Post('flows/:flowId/entries/:id/variations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Add variations; one the FAQ already has is skipped',
    description:
      'They are saved `pending` and get their vector in the background, usually within seconds.',
  })
  addVariations(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addFaqVariationsSchema)) body: AddFaqVariationsInput,
  ) {
    return this.faqs.addVariations(flowId, id, body);
  }

  @Post('flows/:flowId/entries/:id/variations/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Ask the AI for phrasings customers might use (nothing is saved)',
    description:
      'Returns suggestions to review; add the ones you want with the add-variations route.',
  })
  suggest(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(generateFaqVariationsSchema)) body: GenerateFaqVariationsInput,
  ) {
    return this.generate.suggest(flowId, id, body);
  }

  @Patch('flows/:flowId/entries/:id/variations/:variationId')
  @RequirePermission('faq.entries.update')
  @ApiOperation({ summary: 'Reword a variation (its vector is made again)' })
  updateVariation(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variationId', ParseUUIDPipe) variationId: string,
    @Body(zodPipe(updateFaqVariationSchema)) body: UpdateFaqVariationInput,
  ) {
    return this.faqs.updateVariation(flowId, id, variationId, body);
  }

  @Delete('flows/:flowId/entries/:id/variations/:variationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.delete')
  @ApiOperation({ summary: 'Remove a variation (the question itself stays)' })
  async removeVariation(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variationId', ParseUUIDPipe) variationId: string,
  ): Promise<void> {
    await this.faqs.removeVariation(flowId, id, variationId);
  }

  // --- playground, log, learning -------------------------------------------------------------------------------------

  @Post('flows/:flowId/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.read')
  @ApiOperation({
    summary: 'Run the matcher on a typed message and show the decision with its numbers',
    description: 'Sends nothing and never counts in the insights.',
  })
  test(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Body(zodPipe(testFaqQuerySchema)) body: TestFaqQueryInput,
  ) {
    return this.insights.test(flowId, body);
  }

  @Get('flows/:flowId/insights/summary')
  @RequirePermission('faq.insights.read')
  @ApiOperation({
    summary: 'Answer rate, scores, top FAQs and what is unanswered over the last N days',
  })
  summary(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Query(zodPipe(faqInsightsQuerySchema)) query: FaqInsightsQuery,
  ) {
    return this.insights.summary(flowId, query);
  }

  @Get('flows/:flowId/insights/log')
  @RequirePermission('faq.insights.read')
  @ApiOperation({
    summary: 'The match decisions (newest first), optionally only the unanswered or the errors',
  })
  log(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Query(zodPipe(listFaqLogQuerySchema)) query: ListFaqLogQuery,
  ) {
    return this.insights.list(flowId, query);
  }

  @Post('flows/:flowId/insights/log/:id/learn')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary:
      'Make an unanswered customer message a variation of an FAQ, so it is answered from now on',
  })
  learn(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(learnFaqLogSchema)) body: LearnFaqLogInput,
  ) {
    return this.insights.learn(flowId, id, body);
  }

  @Post('flows/:flowId/insights/log/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.update')
  @ApiOperation({ summary: 'Mark an unanswered message as handled without changing any FAQ' })
  async dismiss(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.insights.dismiss(flowId, id);
  }

  // --- settings -----------------------------------------------------------------------------------------------------

  @Get('flows/:flowId/settings')
  @RequirePermission('faq.entries.read')
  @ApiOperation({ summary: "The flow's switch, threshold, margin, limits and usage" })
  getSettings(@Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.settings.get(flowId);
  }

  @Put('flows/:flowId/settings')
  @RequirePermission('faq.settings.manage')
  @ApiOperation({
    summary: 'Save the switch and the matching knobs',
    description:
      'The first save sends no `rowVersion`; every later one sends the version it read (409 ROW_VERSION_CONFLICT otherwise).',
  })
  putSettings(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Body(zodPipe(updateFaqSettingsSchema)) body: UpdateFaqSettingsInput,
  ) {
    return this.settings.update(flowId, body);
  }
}

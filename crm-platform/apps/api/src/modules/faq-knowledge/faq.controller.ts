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
 * The FAQ knowledge base of a workspace (ADR-0021): the FAQs and their variations, a playground that shows how a message would be
 * matched, the match log and what to learn from it, and the workspace's switch and matching knobs.
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

  @Get('entries')
  @RequirePermission('faq.entries.read')
  @ApiOperation({
    summary: 'The FAQs (newest first) with the workspace counts',
    description: 'Cursor pages of 20 by default.',
  })
  list(@Query(zodPipe(listFaqEntriesQuerySchema)) query: ListFaqEntriesQuery) {
    return this.faqs.list(query);
  }

  @Post('entries')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Add an FAQ with its answer (a text, or a flow to start) and optional variations',
  })
  create(@Body(zodPipe(createFaqEntrySchema)) body: CreateFaqEntryInput) {
    return this.faqs.create(body);
  }

  @Post('entries/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary: 'Pause, activate or delete many FAQs at once (delete also needs faq.entries.delete)',
  })
  bulk(@Body(zodPipe(bulkFaqEntriesSchema)) body: BulkFaqEntriesInput) {
    return this.faqs.bulk(body);
  }

  @Get('entries/:id')
  @RequirePermission('faq.entries.read')
  @ApiOperation({ summary: 'One FAQ with every variation and its indexing state' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.faqs.get(id);
  }

  @Patch('entries/:id')
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary: 'Save an FAQ (the form plus the row version it was read at)',
    description:
      'A stale `rowVersion` is refused with 409 ROW_VERSION_CONFLICT; a question another FAQ already has with 409 FAQ_DUPLICATE_QUESTION.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFaqEntrySchema)) body: UpdateFaqEntryInput,
  ) {
    return this.faqs.update(id, body);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.delete')
  @ApiOperation({ summary: 'Delete an FAQ and its variations' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.faqs.remove(id);
  }

  // --- variations ---------------------------------------------------------------------------------------------------

  @Post('entries/:id/variations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Add variations; one the FAQ already has is skipped',
    description:
      'They are saved `pending` and get their vector in the background, usually within seconds.',
  })
  addVariations(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addFaqVariationsSchema)) body: AddFaqVariationsInput,
  ) {
    return this.faqs.addVariations(id, body);
  }

  @Post('entries/:id/variations/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.create')
  @ApiOperation({
    summary: 'Ask the AI for phrasings customers might use (nothing is saved)',
    description:
      'Returns suggestions to review; add the ones you want with the add-variations route.',
  })
  suggest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(generateFaqVariationsSchema)) body: GenerateFaqVariationsInput,
  ) {
    return this.generate.suggest(id, body);
  }

  @Patch('entries/:id/variations/:variationId')
  @RequirePermission('faq.entries.update')
  @ApiOperation({ summary: 'Reword a variation (its vector is made again)' })
  updateVariation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variationId', ParseUUIDPipe) variationId: string,
    @Body(zodPipe(updateFaqVariationSchema)) body: UpdateFaqVariationInput,
  ) {
    return this.faqs.updateVariation(id, variationId, body);
  }

  @Delete('entries/:id/variations/:variationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.delete')
  @ApiOperation({ summary: 'Remove a variation (the question itself stays)' })
  async removeVariation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variationId', ParseUUIDPipe) variationId: string,
  ): Promise<void> {
    await this.faqs.removeVariation(id, variationId);
  }

  // --- playground, log, learning -------------------------------------------------------------------------------------

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.read')
  @ApiOperation({
    summary: 'Run the matcher on a typed message and show the decision with its numbers',
    description: 'Sends nothing and never counts in the insights.',
  })
  test(@Body(zodPipe(testFaqQuerySchema)) body: TestFaqQueryInput) {
    return this.insights.test(body);
  }

  @Get('insights/summary')
  @RequirePermission('faq.insights.read')
  @ApiOperation({
    summary: 'Answer rate, scores, top FAQs and what is unanswered over the last N days',
  })
  summary(@Query(zodPipe(faqInsightsQuerySchema)) query: FaqInsightsQuery) {
    return this.insights.summary(query);
  }

  @Get('insights/log')
  @RequirePermission('faq.insights.read')
  @ApiOperation({
    summary: 'The match decisions (newest first), optionally only the unanswered or the errors',
  })
  log(@Query(zodPipe(listFaqLogQuerySchema)) query: ListFaqLogQuery) {
    return this.insights.list(query);
  }

  @Post('insights/log/:id/learn')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('faq.entries.update')
  @ApiOperation({
    summary:
      'Make an unanswered customer message a variation of an FAQ, so it is answered from now on',
  })
  learn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(learnFaqLogSchema)) body: LearnFaqLogInput,
  ) {
    return this.insights.learn(id, body);
  }

  @Post('insights/log/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('faq.entries.update')
  @ApiOperation({ summary: 'Mark an unanswered message as handled without changing any FAQ' })
  async dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.insights.dismiss(id);
  }

  // --- settings -----------------------------------------------------------------------------------------------------

  @Get('settings')
  @RequirePermission('faq.entries.read')
  @ApiOperation({ summary: 'The workspace switch, threshold, margin, limits and usage' })
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermission('faq.settings.manage')
  @ApiOperation({
    summary: 'Save the switch and the matching knobs',
    description:
      'The first save sends no `rowVersion`; every later one sends the version it read (409 ROW_VERSION_CONFLICT otherwise).',
  })
  putSettings(@Body(zodPipe(updateFaqSettingsSchema)) body: UpdateFaqSettingsInput) {
    return this.settings.update(body);
  }
}

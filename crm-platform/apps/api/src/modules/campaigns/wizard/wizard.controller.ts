import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listWizardBroadcastsQuerySchema,
  saveWizardDraftSchema,
  updateWizardDraftSchema,
  wizardAudienceCountRequestSchema,
  wizardCreditCheckRequestSchema,
  wizardLaunchRequestSchema,
  wizardTestSendRequestSchema,
  wizardVariablePreviewRequestSchema,
  type ListWizardBroadcastsQuery,
  type SaveWizardDraftInput,
  type UpdateWizardDraftInput,
  type WizardAudienceCountRequest,
  type WizardCreditCheckRequest,
  type WizardLaunchRequest,
  type WizardTestSendRequest,
  type WizardVariablePreviewRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { WizardBroadcastsService } from './wizard-broadcasts.service';
import { WizardDraftsService } from './wizard-drafts.service';
import { WizardLaunchService } from './wizard-launch.service';
import { WizardReadService } from './wizard-read.service';
import { WizardReviewService } from './wizard-review.service';
import { WizardTestSendService } from './wizard-test-send.service';

/**
 * The "Create broadcast" wizard (an addition to WaDesk's campaign builder): templates, audience, review, test send and launch. Its
 * own route base (`broadcast-wizard`) so none of it can be shadowed by `campaigns/:id`. Creating and launching ride on
 * `camp.campaigns.create`, the test send has its own key, and the controls reuse `camp.campaigns.control`.
 */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'broadcast-wizard', version: '2' })
export class WizardController {
  constructor(
    private readonly read: WizardReadService,
    private readonly drafts: WizardDraftsService,
    private readonly review: WizardReviewService,
    private readonly tests: WizardTestSendService,
    private readonly launcher: WizardLaunchService,
    private readonly broadcasts: WizardBroadcastsService,
  ) {}

  // ---------------------------------------------------------------- step 1 and 2: what to pick from

  @Get('templates')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Approved templates a broadcast can use, with their placeholders (step 1)',
  })
  templates() {
    return this.read.listTemplates();
  }

  @Get('audience-sources')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({ summary: 'Contact groups and segments with their member counts (step 2)' })
  sources() {
    return this.read.audienceSources();
  }

  @Post('audience/count')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary:
      'How many contacts the audience selects, and how many are skipped (opted out, invalid number)',
    description:
      'The same evaluation the launch writes its recipients from: groups and segments joined, narrowed by the rules. ' +
      '`approximate` is true when the database could not count in time.',
  })
  count(@Body(zodPipe(wizardAudienceCountRequestSchema)) body: WizardAudienceCountRequest) {
    return this.read.countAudience(body.audience);
  }

  // ---------------------------------------------------------------- the draft

  @Post('drafts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Start a broadcast draft (saved as the person goes, listed with the campaigns)',
  })
  createDraft(@Body(zodPipe(saveWizardDraftSchema)) body: SaveWizardDraftInput) {
    return this.drafts.create(body);
  }

  @Get('drafts/:id')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({ summary: 'Read a draft, to resume the wizard' })
  getDraft(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.get(id);
  }

  @Put('drafts/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Save a draft',
    description:
      'Takes whatever is filled in so far. 409 ROW_VERSION_CONFLICT when the draft moved, 409 CAMP_WIZARD_LAUNCHED once it was launched.',
  })
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWizardDraftSchema)) body: UpdateWizardDraftInput,
  ) {
    return this.drafts.update(id, body);
  }

  // ---------------------------------------------------------------- step 3: review

  @Post('credit-check')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary:
      'Balance, estimated cost for this template and these countries, and whether the wallet allows the send',
  })
  credit(@Body(zodPipe(wizardCreditCheckRequestSchema)) body: WizardCreditCheckRequest) {
    return this.review.creditCheck(body);
  }

  @Post('variables/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'The message resolved for a few real contacts, and the placeholders still unmapped',
  })
  variables(@Body(zodPipe(wizardVariablePreviewRequestSchema)) body: WizardVariablePreviewRequest) {
    return this.review.variablePreview(body);
  }

  // ---------------------------------------------------------------- step 4: test and send

  @Post('test-send')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.test')
  @ApiOperation({
    summary: 'Send the draft as a test WhatsApp message to up to ten numbers',
    description:
      '422 CAMP_TEST_RECIPIENTS_INVALID for a number that is not E.164, WALLET_EMPTY when the wallet cannot cover it. Tracking is off; ' +
      'the wallet charges when the delivery is reported.',
  })
  testSend(@Body(zodPipe(wizardTestSendRequestSchema)) body: WizardTestSendRequest) {
    return this.tests.send(body);
  }

  @Get('drafts/:id/test-sends')
  @RequirePermission('camp.campaigns.test')
  @ApiOperation({
    summary: 'The test messages sent for a draft, newest first, with their delivery and charge',
  })
  testLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.tests.log(id);
  }

  @Post('drafts/:id/launch')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Launch the draft: now, at a date and time, or as a recurring series',
    description:
      'Every step is checked again. 422 CAMP_WIZARD_INCOMPLETE (errors[] name the step), 422 WALLET_EMPTY, 422 CAMP_NO_RECIPIENTS, ' +
      '422 CAMP_TEMPLATE_NOT_ALLOWED, 409 ROW_VERSION_CONFLICT.',
  })
  launch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(wizardLaunchRequestSchema)) body: WizardLaunchRequest,
  ) {
    return this.launcher.launch(id, body);
  }

  // ---------------------------------------------------------------- list, detail, controls

  @Get('broadcasts')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'Broadcasts made by the wizard (one-off campaigns and recurring series), newest first',
  })
  list(@Query(zodPipe(listWizardBroadcastsQuerySchema)) query: ListWizardBroadcastsQuery) {
    return this.broadcasts.list(query);
  }

  @Get('broadcasts/:id')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'One broadcast with its schedule, runs and retry summary' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.get(id);
  }

  @Post('broadcasts/:id/pause')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Pause a scheduled or running broadcast, or a recurring series' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.pause(id);
  }

  @Post('broadcasts/:id/resume')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Resume a paused broadcast or series' })
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.resume(id);
  }

  @Post('broadcasts/:id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Cancel a broadcast, or a recurring series and what it has started' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.cancel(id);
  }
}

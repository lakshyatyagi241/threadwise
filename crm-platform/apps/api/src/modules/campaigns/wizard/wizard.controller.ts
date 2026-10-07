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
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  WIZARD_CSV_MAX_BYTES,
  listWizardBroadcastsQuerySchema,
  listWizardHistoryQuerySchema,
  saveWizardDraftSchema,
  updateWizardDraftSchema,
  wizardAudienceCountRequestSchema,
  wizardContactsQuerySchema,
  wizardCreditCheckRequestSchema,
  wizardLaunchRequestSchema,
  wizardEligibilityRequestSchema,
  wizardTestSendRequestSchema,
  wizardVariablePreviewRequestSchema,
  type ListWizardBroadcastsQuery,
  type ListWizardHistoryQuery,
  type SaveWizardDraftInput,
  type UpdateWizardDraftInput,
  type WizardAudienceCountRequest,
  type WizardContactsQuery,
  type WizardCreditCheckRequest,
  type WizardEligibilityRequest,
  type WizardLaunchRequest,
  type WizardTestSendRequest,
  type WizardVariablePreviewRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { type UploadedCsv } from '../../crm';
import { WizardBroadcastsService } from './wizard-broadcasts.service';
import { WizardContactsService } from './wizard-contacts.service';
import { WizardCsvService } from './wizard-csv.service';
import { WizardEligibilityService } from './wizard-eligibility.service';
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
const csvUpload = FileInterceptor('file', { limits: { fileSize: WIZARD_CSV_MAX_BYTES, files: 1 } });

@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'broadcast-wizard', version: '2' })
export class WizardController {
  constructor(
    private readonly read: WizardReadService,
    private readonly drafts: WizardDraftsService,
    private readonly review: WizardReviewService,
    private readonly eligibilityCheck: WizardEligibilityService,
    private readonly tests: WizardTestSendService,
    private readonly launcher: WizardLaunchService,
    private readonly broadcasts: WizardBroadcastsService,
    private readonly contacts: WizardContactsService,
    private readonly csv: WizardCsvService,
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

  @Get('senders')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({ summary: 'Connected WhatsApp numbers a broadcast can be sent from (step 1)' })
  senders() {
    return this.read.listSenders();
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

  @Post('contacts/query')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'The contacts table of the audience step: search, conditions, page and total',
    description:
      'Searched and filtered on the server (the conditions are compiled by the segments rule engine). A POST because the conditions are a tree; it writes nothing.',
  })
  contactsPage(@Body(zodPipe(wizardContactsQuerySchema)) body: WizardContactsQuery) {
    return this.contacts.page(body);
  }

  @Get('csv/template')
  @RequirePermission('camp.campaigns.create')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="broadcast-numbers-template.csv"')
  @ApiOperation({
    summary: 'A CSV template for "Broadcast via CSV" (a phone column, optional names)',
  })
  csvTemplate(): string {
    return this.csv.template();
  }

  @Post('csv')
  @RequirePermission('camp.campaigns.create')
  @UseInterceptors(csvUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a CSV of numbers for "Broadcast via CSV": parsed, validated and stored for this workspace',
    description:
      'Form field `file`. Numbers are normalised to E.164, repeated numbers kept once, invalid rows reported with their line. Nothing is ' +
      'written to the contacts: numbers that are not contacts yet become contacts when the broadcast is launched. 422 CON_IMPORT_FILE_INVALID, ' +
      '413 CON_IMPORT_TOO_LARGE.',
  })
  uploadCsv(@UploadedFile() file: UploadedCsv | undefined) {
    return this.csv.upload(file);
  }

  @Get('csv/:id')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({ summary: 'A stored CSV upload: counts, preview and the first rejected rows' })
  csvReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.csv.report(id);
  }

  @Get('csv/:id/errors')
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'The rows of a CSV upload that cannot be used, with line numbers, as a CSV',
  })
  async csvErrors(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="broadcast-numbers-errors.csv"');
    return this.csv.errorsCsv(id);
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

  @Post('eligibility')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary:
      'Can this broadcast really go out: the contacts that can receive it, the template and number, and how it is billed',
  })
  eligibility(@Body(zodPipe(wizardEligibilityRequestSchema)) body: WizardEligibilityRequest) {
    return this.eligibilityCheck.check(body);
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

  @Get('history')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary:
      'Broadcast runs for the History (every run, newest first) and Scheduled (waiting, soonest first) pages',
  })
  history(@Query(zodPipe(listWizardHistoryQuerySchema)) query: ListWizardHistoryQuery) {
    return this.broadcasts.history(query);
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

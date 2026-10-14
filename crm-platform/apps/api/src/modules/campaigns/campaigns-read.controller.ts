import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  broadcastComposeQuerySchema,
  campaignSummaryPeopleQuerySchema,
  campaignSummaryQuerySchema,
  listCampaignsQuerySchema,
  listRecipientsQuerySchema,
  type BroadcastComposeQuery,
  type CampaignSummaryPeopleQuery,
  type CampaignSummaryQuery,
  type ListCampaignsQuery,
  type ListRecipientsQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignsReadService } from './campaigns-read.service';
import { SAMPLE_CSV, SAMPLE_CSV_FILE } from './campaign-rules';
import { CampaignSummaryService } from './summary/campaign-summary.service';

/** What the campaign screens read (TW-CAMP-001, 002, 004, 010, 019). */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns', version: '2' })
export class CampaignsReadController {
  constructor(
    private readonly read: CampaignsReadService,
    private readonly summary: CampaignSummaryService,
  ) {}

  @Get()
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The campaigns with filters, tiles, status counts and health cards',
    description:
      'Counts come from the recipient rows. A campaign whose recipients are all resolved is finished by this call.',
  })
  list(@Query(zodPipe(listCampaignsQuerySchema)) query: ListCampaignsQuery) {
    return this.read.list(query);
  }

  @Get('builder')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'Senders, templates, groups, tags and flows for the builder' })
  builder(@Query(zodPipe(broadcastComposeQuerySchema)) query: BroadcastComposeQuery) {
    return this.read.builder(query);
  }

  @Get('sample-csv')
  @RequirePermission('camp.campaigns.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', `attachment; filename="${SAMPLE_CSV_FILE}"`)
  @ApiOperation({ summary: 'A sample recipients CSV: name, country_code, phone' })
  sampleCsv(): string {
    return SAMPLE_CSV;
  }

  // Declared before `:id` so "summary" is never read as a campaign id.
  @Get('summary/forms')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The forms a director can pick as "an application" for the campaign summary',
    description:
      'Web forms and WhatsApp forms of the workspace; a kind is listed only to a caller who may read forms.',
  })
  summaryForms() {
    return this.summary.forms();
  }

  @Get(':id/summary')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'Director summary: people messaged, delivered, read, wrote back, filled a form',
    description:
      'Distinct people, not messages. `cameBackDays` is 3, 7 or 14; `formIds` limits which forms count. Cached for a minute. `filledForm` is null without `record.form-submissions.read`.',
  })
  campaignSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(campaignSummaryQuerySchema)) query: CampaignSummaryQuery,
  ) {
    return this.summary.summary('campaign', id, query);
  }

  @Get(':id/summary/people')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The people behind a summary figure: came_back, filled_form or not_reached',
    description:
      'Keyset page, 100 at most. `filled_form` needs `record.form-submissions.read`. Names and numbers are what the recipients tab already shows.',
  })
  campaignSummaryPeople(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(campaignSummaryPeopleQuerySchema)) query: CampaignSummaryPeopleQuery,
  ) {
    return this.summary.people('campaign', id, query);
  }

  @Get(':id/config')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'The whole campaign for the edit form, with its recipient contacts' })
  config(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.config(id);
  }

  @Get(':id')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The detail page: rates, funnel, charts, preview, audience, failures, replies',
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.detail(id);
  }

  @Get(':id/live')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'Live stats: the counts, rates, queued and processing numbers the detail page polls',
    description:
      'Recounted from the recipient rows on every call. `inFlight` is true while the campaign is scheduled or running; the page stops asking when it is false.',
  })
  live(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.live(id);
  }

  @Get(':id/statistics')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary:
      'Statistics: where every recipient is now, the funnel figures and the campaign timeline',
    description:
      '`breakdown` counts each recipient once at its status, so it adds up to `total`; `counts` and `rates` are the cumulative funnel (a read message is also delivered and sent).',
  })
  statistics(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.statistics(id);
  }

  @Get(':id/recipients')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'The recipient log, 50 a page, with a status filter and a search' })
  recipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listRecipientsQuerySchema)) query: ListRecipientsQuery,
  ) {
    return this.read.recipients(id, query);
  }
}

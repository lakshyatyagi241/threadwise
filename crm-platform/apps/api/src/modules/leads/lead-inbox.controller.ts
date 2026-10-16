import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  backfillLeadsSchema,
  leadInboxSummaryQuerySchema,
  listLeadInboxQuerySchema,
  listLeadSyncRunsQuerySchema,
  retryLeadInboxSchema,
  type BackfillLeadsInput,
  type LeadInboxSummaryQuery,
  type ListLeadInboxQuery,
  type ListLeadSyncRunsQuery,
  type RetryLeadInboxInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { LeadInboxService } from './lead-inbox.service';
import { LeadSyncService } from './lead-sync.service';

/**
 * The lead inbox (BL-014, spec L-17, L-18): every source's deliveries in one list, a masked look at one, retry (one or many), and for
 * the sources that can be pulled "Sync now" and a backfill with their progress. Same gate as the source screens: the plan's
 * `lead_sources` feature, `leads.sources.read` to look, `leads.sources.manage` to open a payload, retry, sync or backfill.
 */
@ApiTags('lead-inbox')
@ActorKinds('user')
@RequirePlanFeature('lead_sources')
@Controller({ path: 'lead-inbox', version: '2' })
export class LeadInboxController {
  constructor(
    private readonly inbox: LeadInboxService,
    private readonly sync: LeadSyncService,
  ) {}

  @Get()
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'Every delivery of every source, newest received first',
    description:
      "Filters: source, status (`attention` = needs review or failed), reason, test leads, a received-at range, the start of the sender's id. No payloads. Cursor paged.",
  })
  list(@Query(zodPipe(listLeadInboxQuerySchema)) query: ListLeadInboxQuery) {
    return this.inbox.list(query);
  }

  // The literal routes come before ':id', which would otherwise take them for an id.

  @Get('summary')
  @RequirePermission('leads.sources.read')
  @ApiOperation({ summary: 'Deliveries per status over a window (default the last 30 days)' })
  summary(@Query(zodPipe(leadInboxSummaryQuerySchema)) query: LeadInboxSummaryQuery) {
    return this.inbox.summary(query);
  }

  @Get('sources')
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'The sources that can be pulled',
    description:
      'What each can do (sync, backfill), its own rate limit, when "Sync now" is accepted again, and its open and latest run.',
  })
  pullSources() {
    return this.sync.pullSources();
  }

  @Get('runs')
  @RequirePermission('leads.sources.read')
  @ApiOperation({ summary: 'Recent syncs and backfills with their progress' })
  runs(@Query(zodPipe(listLeadSyncRunsQuerySchema)) query: ListLeadSyncRunsQuery) {
    return this.sync.recent(query);
  }

  @Post('retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Retry many leads that wait',
    description:
      "Up to 100, one after the other, each from its stored payload under its source's current settings. A lead that cannot be retried is reported with the reason; the others go on.",
  })
  retryMany(@Body(zodPipe(retryLeadInboxSchema)) body: RetryLeadInboxInput) {
    return this.inbox.retryMany(body.eventIds);
  }

  @Post('backfill')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Pull a date range again from the sources that support it',
    description:
      "A worker job per source, one at a time per source, at the source's own pace. Leads already received are recognised and write nothing. A source that cannot, is paused, has a run going or was asked too recently is reported in `skipped`.",
  })
  backfill(@Body(zodPipe(backfillLeadsSchema)) body: BackfillLeadsInput) {
    return this.sync.backfill(body);
  }

  @Post('sources/:sourceId/sync')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Sync now: fetch what is new at one source',
    description:
      '409 LEAD_SYNC_NOT_SUPPORTED (a source that sends its own leads), 409 LEAD_SYNC_IN_PROGRESS, 429 LEAD_SYNC_TOO_SOON with the seconds to wait.',
  })
  syncNow(@Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.sync.syncNow(sourceId);
  }

  @Get(':id')
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'One delivery with its payload, personal data masked',
    description:
      "Phone numbers, e-mail addresses, names, addresses and free text are hidden and secrets redacted. Opening it is audited. The unmasked payload is the source's own event route.",
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.detail(id);
  }

  @Post(':id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Retry one lead that waits',
    description:
      "409 LEAD_EVENT_NOT_RETRYABLE, LEAD_PAYLOAD_PURGED or LEAD_SOURCE_PAUSED, as on the source's own route.",
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.retry(id);
  }
}

import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listBroadcastRecipientsQuerySchema,
  listBroadcastsQuerySchema,
  type ListBroadcastRecipientsQuery,
  type ListBroadcastsQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BroadcastsComposeService } from './broadcasts-compose.service';
import { BroadcastsReadService } from './broadcasts-read.service';

/** The broadcast screens' data: list, tiles, detail, recipients and live counters (TW-BCAST-001, 002, 030 to 036). */
@ApiTags('broadcasts')
@ActorKinds('user')
@Controller({ path: 'broadcasts', version: '2' })
export class BroadcastsReadController {
  constructor(
    private readonly read: BroadcastsReadService,
    private readonly composer: BroadcastsComposeService,
  ) {}

  @Get()
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({ summary: 'List broadcasts, newest first, filtered by status, range and name' })
  list(@Query(zodPipe(listBroadcastsQuerySchema)) query: ListBroadcastsQuery) {
    return this.read.list(query);
  }

  // Declared before `:id` so "compose" and "summary" are never read as an id.
  @Get('compose')
  @RequirePermission('bcast.broadcasts.create')
  @ApiOperation({
    summary: 'What the compose page opens with: approved templates and connected sending numbers',
  })
  compose() {
    return this.composer.compose();
  }

  @Get('summary')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({
    summary:
      'The tiles and status counts above the list (whole workspace, ignores the list filter)',
  })
  summary() {
    return this.read.summary();
  }

  @Get(':id')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({
    summary: 'One broadcast: header numbers, template, sender, charts data and events',
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.detail(id);
  }

  @Get(':id/recipients')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({
    summary: 'Recipients of a broadcast, newest first, filtered by status and name or phone',
  })
  recipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listBroadcastRecipientsQuerySchema)) query: ListBroadcastRecipientsQuery,
  ) {
    return this.read.recipients(id, query);
  }

  @Get(':id/live')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({
    summary: 'Live counters for polling; `inFlight` turns false when the broadcast is over',
  })
  live(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.live(id);
  }

  @Get(':id/statistics')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({ summary: 'Sent, delivered, read, failed, processing and queued counts' })
  statistics(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.statistics(id);
  }
}

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Body,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callAnalyticsQuerySchema,
  callLogListQuerySchema,
  setRecordingHoldInputSchema,
  type CallAnalyticsQuery,
  type CallLogListQuery,
  type RecordScope,
  type SetRecordingHoldInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CallLogsService } from './call-logs.service';
import { CallRecordingsService } from './call-recordings.service';

/**
 * Call logs and call analytics (TW-CALL-022 onward). `call.logs.read` opens them and its record scope says whose calls a person sees
 * (all, their team's, or only the ones they handled); playing a recording needs `call.recordings.play` as well. The plan feature
 * `waba_calling` gates every route, in the service, like the dial routes. Ids are uuids of the caller's workspace: another workspace's
 * call, or one outside the person's scope, is a 404.
 */
@ApiTags('calling')
@ActorKinds('user')
@Controller({ path: 'calling/call-logs', version: '2' })
export class CallLogsController {
  constructor(
    private readonly logs: CallLogsService,
    private readonly recordings: CallRecordingsService,
  ) {}

  @Get()
  @RequirePermission('call.logs.read')
  @ApiOperation({
    summary:
      'The call log: a page of calls, Reference’s four totals and the totals of the selection',
    description:
      'Filters: range (24h, 7d, 30d) or from/to days in tz, status, direction, numberId, agentId, q (a phone number or part of the contact name).',
  })
  list(
    @Query(zodPipe(callLogListQuerySchema)) q: CallLogListQuery,
    @GrantedScope('call.logs.read') scope: RecordScope,
  ) {
    return this.logs.list(q, scope);
  }

  @Get('filters')
  @RequirePermission('call.logs.read')
  @ApiOperation({ summary: 'The numbers and teammates the filter bar offers' })
  filters(@GrantedScope('call.logs.read') scope: RecordScope) {
    return this.logs.filters(scope);
  }

  @Get('analytics')
  @RequirePermission('call.logs.read')
  @ApiOperation({
    summary:
      'Calls over time, answered rate, by teammate, by hour of the week, average handle time',
  })
  analytics(
    @Query(zodPipe(callAnalyticsQuerySchema)) q: CallAnalyticsQuery,
    @GrantedScope('call.logs.read') scope: RecordScope,
  ) {
    return this.logs.analytics(q, scope);
  }

  @Get(':id')
  @RequirePermission('call.logs.read')
  @ApiOperation({ summary: 'One call with its timeline and whether it has a recording' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('call.logs.read') scope: RecordScope,
  ) {
    return this.logs.detail(id, scope);
  }

  @Post(':id/playback')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.logs.read')
  @ApiOperation({
    summary: 'A link that plays the recording for a few minutes (audited each time)',
    description: 'Needs call.recordings.play as well. 404 when the call has no recording.',
  })
  playback(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('call.logs.read') scope: RecordScope,
  ) {
    return this.logs.playback(id, scope);
  }

  @Put(':id/recording-hold')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('privacy.requests.manage')
  @ApiOperation({
    summary: 'Place or lift a legal hold on a recording',
    description:
      'A held recording is skipped by the retention sweep and refuses a manual delete. A reason is required to place a hold; both are audited.',
  })
  async hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setRecordingHoldInputSchema)) body: SetRecordingHoldInput,
  ): Promise<void> {
    await this.recordings.setHold(id, body);
  }
}

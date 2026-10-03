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
  enrollContactsInputSchema,
  flowAnalyticsQuerySchema,
  listFlowRunsQuerySchema,
  listFlowSubscribersQuerySchema,
  startFlowOnConversationInputSchema,
  type EnrollContactsInput,
  type FlowAnalyticsQuery,
  type ListFlowRunsQuery,
  type ListFlowSubscribersQuery,
  type StartFlowOnConversationInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FlowRuntimeService } from './flow-runtime.service';

/**
 * Running flows, as the workspace sees it (FLR, TW-FLR-008, 051 to 058): enrol contacts, who is in a flow, pause, resume and retry,
 * the runs and their log, the numbers. Reads need `flr.runs.read`, every change `flr.runs.manage` (Reference: the workspace role admin).
 * Everything is addressed by uuid in the caller's workspace, so another workspace's id is a 404.
 */
@ApiTags('flow-runtime')
@ActorKinds('user')
@Controller({ path: 'flow-runtime', version: '2' })
export class FlowRuntimeController {
  constructor(private readonly svc: FlowRuntimeService) {}

  @Get('flows')
  @RequirePermission('flr.runs.read')
  @ApiOperation({
    summary: "The workspace's flows with their subscriber counts, for the pickers of these screens",
  })
  flows() {
    return this.svc.listFlows();
  }

  @Get('runs')
  @RequirePermission('flr.runs.read')
  @ApiOperation({ summary: 'Runs, newest first, by flow, contact, status or what started them' })
  runs(@Query(zodPipe(listFlowRunsQuerySchema)) q: ListFlowRunsQuery) {
    return this.svc.listRuns(q);
  }

  @Get('runs/:id')
  @RequirePermission('flr.runs.read')
  @ApiOperation({ summary: 'One run: where it stands, its variables and its step-by-step log' })
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.runDetail(id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({ summary: 'End a live run; the customer is told nothing' })
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.svc.cancelRun(id);
  }

  @Post('flows/:flowId/enroll')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({
    summary: 'Enrol chosen contacts, or every contact of a group, into an active flow',
    description:
      'Up to 500 contacts per request. A contact already in the flow is counted and not launched again. 422 FLR_FLOW_INACTIVE.',
  })
  enroll(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Body(zodPipe(enrollContactsInputSchema)) body: EnrollContactsInput,
  ) {
    return this.svc.enroll(flowId, body);
  }

  @Get('flows/:flowId/subscribers')
  @RequirePermission('flr.runs.read')
  @ApiOperation({ summary: 'Who is in a flow, with counts over all of them' })
  subscribers(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Query(zodPipe(listFlowSubscribersQuerySchema)) q: ListFlowSubscribersQuery,
  ) {
    return this.svc.subscribersOf(flowId, q);
  }

  @Post('flows/:flowId/retry-failed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({ summary: 'Retry every failed subscriber of a flow' })
  retryFailed(@Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.svc.retryFailed(flowId);
  }

  @Post('subscribers/:id/pause')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({
    summary: 'Pause a subscriber: the run keeps its place and does nothing until resumed',
  })
  async pause(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.svc.pause(id);
  }

  @Post('subscribers/:id/resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({ summary: 'Resume a paused subscriber where its run left off' })
  async resume(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.svc.resume(id);
  }

  @Post('subscribers/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({
    summary: 'Retry a failed subscriber with a new run (409 FLR_NOT_RETRYABLE otherwise)',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(id);
  }

  @Get('analytics')
  @RequirePermission('flr.runs.read')
  @ApiOperation({
    summary: 'Totals, completion rate, trend, failure reasons and the flows that ran most',
  })
  analytics(@Query(zodPipe(flowAnalyticsQuerySchema)) q: FlowAnalyticsQuery) {
    return this.svc.analytics(q);
  }

  @Post('conversations/:id/start')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('flr.runs.manage')
  @ApiOperation({ summary: 'Start a flow on an open conversation (the inbox "start flow")' })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(startFlowOnConversationInputSchema)) body: StartFlowOnConversationInput,
  ) {
    return this.svc.startOnConversation(id, body.flowId);
  }
}

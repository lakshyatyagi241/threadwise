import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  outboxReplayRequestSchema,
  wabaReplayRequestSchema,
  type OutboxReplayRequest,
  type WabaReplayRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AsyncOpsService } from './async-ops.service';

const limitQuery = z.coerce.number().int().min(1).max(500).default(100);

/**
 * Failed background work (ASYNC-044): what ran out of retries, and a replay. Every operator may look; only a super admin replays.
 * IP allowlist and MFA come from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/async-ops', version: '2' })
export class AsyncOpsController {
  constructor(private readonly ops: AsyncOpsService) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get('outbox/dead')
  @ApiOperation({ summary: 'Outbox events that ran out of retries, grouped by type (no payload)' })
  deadOutbox() {
    return this.ops.deadOutbox();
  }

  @Post('outbox/replay')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Re-queue the dead events of one type (workspaces that are not active are skipped)',
  })
  replayOutbox(@Body(zodPipe(outboxReplayRequestSchema)) body: OutboxReplayRequest) {
    return this.ops.replayOutbox(body, this.operatorId());
  }

  @Get('waba-ingest/failed')
  @ApiOperation({ summary: 'WhatsApp webhook payloads that failed for good (no payload)' })
  failedWaba(@Query('limit', zodPipe(limitQuery)) limit: number) {
    return this.ops.failedWaba(limit);
  }

  @Post('waba-ingest/replay')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Retry failed WhatsApp webhook payloads under their own job ids' })
  replayWaba(@Body(zodPipe(wabaReplayRequestSchema)) body: WabaReplayRequest) {
    return this.ops.replayWaba(body, this.operatorId());
  }

  @Get('webhook-retry/failed')
  @ApiOperation({
    summary:
      'Channel webhook events (Telegram, Viber, LINE, Facebook) that failed for good (no payload)',
  })
  failedWebhookRetry(@Query('limit', zodPipe(limitQuery)) limit: number) {
    return this.ops.failedWebhookRetry(limit);
  }

  @Post('webhook-retry/replay')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Retry failed channel webhook events with a fresh retry budget' })
  replayWebhookRetry(@Body(zodPipe(wabaReplayRequestSchema)) body: WabaReplayRequest) {
    return this.ops.replayWebhookRetry(body, this.operatorId());
  }
}

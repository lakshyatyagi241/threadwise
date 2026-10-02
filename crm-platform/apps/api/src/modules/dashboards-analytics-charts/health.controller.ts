import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { clearQueueRequestSchema, type ClearQueueRequest } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { HealthService } from './health.service';

const refreshQuerySchema = z.object({ fresh: z.enum(['1', 'true']).optional() });

/** Operator console system health (WD-DASH-048..051). Every operator reads; only super admins clear queues. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/health', version: '2' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Five core probes, the banner, queue depth and host vitals' })
  snapshot(@Query(zodPipe(refreshQuerySchema)) q: z.infer<typeof refreshQuerySchema>) {
    return this.health.snapshot(q.fresh !== undefined);
  }

  @Post('clear-queue')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Drain waiting and delayed jobs and remove failed ones (active jobs untouched)',
  })
  clear(@Body(zodPipe(clearQueueRequestSchema)) body: ClearQueueRequest) {
    return this.health.clearQueues(body.queue);
  }
}

import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1CreateScheduledSchema,
  v1ListQuerySchema,
  type V1CreateScheduled,
  type V1ListQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../http/v1-envelope';
import { UuidParam } from './bulk-input';
import { V1ScheduledAdapter } from './scheduled.adapter';
import { toV1Scheduled } from './scheduled.mapper';

@V1Controller('scheduled')
@RequirePlanFeature('public_api')
export class V1ScheduledController {
  constructor(private readonly adapter: V1ScheduledAdapter) {}

  @Post()
  @RequireApiScope('scheduled:write')
  @ApiOperation({ summary: 'Schedule a one-off message' })
  async create(@Body(zodPipe(v1CreateScheduledSchema)) body: V1CreateScheduled) {
    const f = await this.adapter.create(body);
    return ok(toV1Scheduled(f.schedule, f.extras));
  }

  @Get()
  @RequireApiScope('scheduled:read')
  @ApiOperation({ summary: 'List scheduled messages' })
  async list(@Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery) {
    const res = await this.adapter.list(paging);
    return ok(
      res.items.map((f) => toV1Scheduled(f.schedule, f.extras)),
      pageMeta(res.page),
    );
  }

  @Get(':id')
  @RequireApiScope('scheduled:read')
  @ApiOperation({ summary: 'One scheduled message' })
  async show(@Param('id', UuidParam) id: string) {
    const f = await this.adapter.show(id);
    return ok(toV1Scheduled(f.schedule, f.extras));
  }

  // DELETE cancels and keeps the row, as WaDesk does (WD-API-094 rule 3).
  @Delete(':id')
  @RequireApiScope('scheduled:write')
  @ApiOperation({ summary: 'Cancel a scheduled message' })
  async cancel(@Param('id', UuidParam) id: string) {
    const f = await this.adapter.cancel(id);
    return ok(toV1Scheduled(f.schedule, f.extras));
  }
}

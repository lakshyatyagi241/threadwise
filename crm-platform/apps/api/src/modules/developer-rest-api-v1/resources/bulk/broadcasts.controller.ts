import { Body, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1BroadcastListFilterSchema,
  v1CreateBroadcastSchema,
  v1ListQuerySchema,
  type V1BroadcastListFilter,
  type V1CreateBroadcast,
  type V1ListQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { ok, pageMeta } from '../../http/v1-envelope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { V1BroadcastsAdapter } from './broadcasts.adapter';
import { toV1Broadcast, toV1BroadcastDetail } from './broadcasts.mapper';
import { UuidParam } from './bulk-input';

@V1Controller('broadcasts')
@RequirePlanFeature('public_api')
export class V1BroadcastsController {
  constructor(private readonly adapter: V1BroadcastsAdapter) {}

  @Post()
  @RequireApiScope('broadcasts:write')
  @ApiOperation({ summary: 'Create a broadcast' })
  async create(@Body(zodPipe(v1CreateBroadcastSchema)) body: V1CreateBroadcast) {
    const res = await this.adapter.create(body);
    const [first] = res.broadcasts;
    return ok(toV1Broadcast(first!), {
      broadcast_ids: res.broadcasts.map((b) => b.id),
      devices_count: res.devicesCount,
    });
  }

  @Get()
  @RequireApiScope('broadcasts:read')
  @ApiOperation({ summary: 'List broadcasts, newest first' })
  async list(
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
    @Query(zodPipe(v1BroadcastListFilterSchema)) filter: V1BroadcastListFilter,
  ) {
    const res = await this.adapter.list({ ...paging, status: filter.status });
    return ok(res.data.map(toV1Broadcast), pageMeta(res.page));
  }

  @Get(':id')
  @RequireApiScope('broadcasts:read')
  @ApiOperation({ summary: 'One broadcast with live status counts' })
  async show(@Param('id', UuidParam) id: string) {
    return ok(toV1BroadcastDetail(await this.adapter.show(id)));
  }

  @Get(':id/recipients')
  @RequireApiScope('broadcasts:read')
  @ApiOperation({ summary: "A broadcast's recipients and delivery stats" })
  async recipients(
    @Param('id', UuidParam) id: string,
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
  ) {
    const { page, stats } = await this.adapter.recipients(id, paging);
    return ok(
      page.data.map((r) => ({
        contact_id: r.contactId,
        status: r.status || 'pending',
        error: r.error,
        wa_message_id: r.providerMessageId,
        sent_at: r.sentAt,
        delivered_at: r.deliveredAt,
        read_at: r.readAt,
      })),
      { ...pageMeta(page.page), stats },
    );
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequireApiScope('broadcasts:write')
  @ApiOperation({ summary: 'Stop a scheduled or in-flight broadcast' })
  async stop(@Param('id', UuidParam) id: string) {
    return ok(toV1BroadcastDetail(await this.adapter.stop(id)));
  }
}

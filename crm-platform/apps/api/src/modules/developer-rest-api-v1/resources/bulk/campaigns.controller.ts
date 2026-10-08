import { Body, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1CampaignListFilterSchema,
  v1CreateCampaignSchema,
  v1ListQuerySchema,
  type V1CampaignListFilter,
  type V1CreateCampaign,
  type V1ListQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../http/v1-envelope';
import { V1CampaignsAdapter } from './campaigns.adapter';
import { countsOf, toV1Campaign } from './campaigns.mapper';
import { UuidParam } from './bulk-input';

@V1Controller('campaigns')
@RequirePlanFeature('public_api')
export class V1CampaignsController {
  constructor(private readonly adapter: V1CampaignsAdapter) {}

  // Registered before `:id`, so "statistics" is never read as an id (TW-API-085 rule 4).
  @Get('statistics')
  @RequireApiScope('campaigns:read')
  @ApiOperation({ summary: 'Workspace campaign statistics' })
  async statistics() {
    return ok(await this.adapter.statistics());
  }

  @Get()
  @RequireApiScope('campaigns:read')
  @ApiOperation({ summary: 'List campaigns, newest first' })
  async list(
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
    @Query(zodPipe(v1CampaignListFilterSchema)) filter: V1CampaignListFilter,
  ) {
    const res = await this.adapter.list(paging, filter);
    return ok(
      res.items.map((c) => toV1Campaign(c)),
      pageMeta(res.page),
    );
  }

  // 201 with the stored row: counts all 0 until a read, as Reference (TW-API-087 rule 7).
  @Post()
  @RequireApiScope('campaigns:write')
  @ApiOperation({ summary: 'Create and dispatch a campaign' })
  async create(@Body(zodPipe(v1CreateCampaignSchema)) body: V1CreateCampaign) {
    return ok(toV1Campaign(await this.adapter.create(body), { asStored: true }));
  }

  @Get(':id')
  @RequireApiScope('campaigns:read')
  @ApiOperation({ summary: 'One campaign with live counts' })
  async show(@Param('id', UuidParam) id: string) {
    const facts = await this.adapter.show(id);
    const counts = countsOf(facts.row);
    // `meta.metrics` are unrounded percentages while `data.metrics` are rounded to two decimals (Reference, QUIRK 3).
    const raw = {
      delivery_rate: counts.sent > 0 ? (counts.delivered / counts.sent) * 100 : 0,
      read_rate: counts.delivered > 0 ? (counts.read / counts.delivered) * 100 : 0,
      click_rate: counts.sent > 0 ? (counts.clicked / counts.sent) * 100 : 0,
      response_rate: counts.sent > 0 ? (counts.responded / counts.sent) * 100 : 0,
    };
    return ok(toV1Campaign(facts), {
      counts: {
        total: counts.total_recipients,
        sent: counts.sent,
        delivered: counts.delivered,
        read: counts.read,
        failed: counts.failed,
        clicked: counts.clicked,
        responded: counts.responded,
      },
      metrics: raw,
    });
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequireApiScope('campaigns:write')
  @ApiOperation({ summary: 'Stop a running, scheduled or paused campaign' })
  async stop(@Param('id', UuidParam) id: string) {
    return ok(toV1Campaign(await this.adapter.stop(id)));
  }

  @Delete(':id')
  @RequireApiScope('campaigns:write')
  @ApiOperation({ summary: 'Delete a finished or scheduled campaign' })
  async remove(@Param('id', UuidParam) id: string) {
    await this.adapter.remove(id);
    return ok({ deleted: true, message: 'Campaign deleted.' });
  }
}

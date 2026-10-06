import { Body, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1CreateDealSchema,
  v1DealsQuerySchema,
  v1ListQuerySchema,
  type V1CreateDeal,
  type V1DealsQuery,
  type V1ListQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../../http/v1-envelope';
import { DealsPlanGuard } from './deals-plan.guard';
import { V1DealsService } from './deals.service';

// The plan guard sits above `@V1Controller` so it runs after the key guard (it needs the key's workspace) and before any pipe.
@UseGuards(DealsPlanGuard)
@V1Controller('deals')
export class V1DealsController {
  constructor(private readonly deals: V1DealsService) {}

  @Get()
  @RequireApiScope('deals:read')
  @ApiOperation({ summary: 'List deals, newest first, filtered by pipeline, stage or status' })
  async list(
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
    @Query(zodPipe(v1DealsQuerySchema)) filter: V1DealsQuery,
  ) {
    const res = await this.deals.list(paging, filter);
    return ok(res.data, pageMeta(res.page));
  }

  @Get(':id')
  @RequireApiScope('deals:read')
  @ApiOperation({ summary: 'One deal' })
  async show(@Param('id') id: string) {
    return ok(await this.deals.show(id));
  }

  @Post()
  @RequireApiScope('deals:write')
  @ApiOperation({
    summary: 'Create a deal; an unknown pipeline, stage or contact falls back instead of failing',
  })
  async create(@Body(zodPipe(v1CreateDealSchema)) body: V1CreateDeal) {
    return ok(await this.deals.create(body));
  }

  // The body is validated after the deal is found, so an unknown id with a bad body is a 404 (WD-API-051 rule 1).
  @Put(':id')
  @RequireApiScope('deals:write')
  @ApiOperation({
    summary:
      'Change only the fields sent; a new `stage_id` moves the deal and runs the stage engine',
  })
  async update(@Param('id') id: string, @Body() raw: unknown) {
    return ok(await this.deals.update(id, raw));
  }

  @Patch(':id')
  @RequireApiScope('deals:write')
  @ApiOperation({ summary: 'Alias of PUT' })
  async patch(@Param('id') id: string, @Body() raw: unknown) {
    return ok(await this.deals.update(id, raw));
  }

  @Delete(':id')
  @RequireApiScope('deals:write')
  @ApiOperation({ summary: 'Delete a deal and its timeline' })
  async remove(@Param('id') id: string) {
    return ok(await this.deals.remove(id));
  }
}

import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1EnrollSchema,
  v1ListQuerySchema,
  v1SubscribersQuerySchema,
  type V1Enroll,
  type V1ListQuery,
  type V1SubscribersQuery,
} from '@crm/contracts';
import { Idempotent } from '../../../../../common/decorators';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../../http/v1-envelope';
import { V1FlowsService } from './flows.v1.service';

const idPipe = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** Chatbot flows (TW-API-044 to 047). The signed `/public/v1/flows` controller of the runtime domain is a different scheme and is untouched. */
@V1Controller('flows')
export class V1FlowsController {
  constructor(private readonly flows: V1FlowsService) {}

  @Get()
  @RequireApiScope('flows:read')
  @ApiOperation({ summary: 'Flows, most recently updated first (cursor paginated)' })
  async list(@Query(zodPipe(v1ListQuerySchema)) q: V1ListQuery) {
    const { items, page } = await this.flows.list(q);
    return ok(items, pageMeta(page));
  }

  @Get(':id')
  @RequireApiScope('flows:read')
  @ApiOperation({ summary: 'One flow' })
  async show(@Param('id', idPipe) id: string) {
    return ok(await this.flows.show(id));
  }

  @Post(':id/enroll')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireApiScope('flows:write')
  @ApiOperation({ summary: 'Enrol a contact by id or phone' })
  async enroll(@Param('id', idPipe) id: string, @Body(zodPipe(v1EnrollSchema)) body: V1Enroll) {
    return ok(await this.flows.enroll(id, body));
  }

  @Get(':id/subscribers')
  @RequireApiScope('flows:read')
  @ApiOperation({ summary: "A flow's subscribers, newest first, with counts over all of them" })
  async subscribers(
    @Param('id', idPipe) id: string,
    @Query(zodPipe(v1SubscribersQuerySchema)) q: V1SubscribersQuery,
  ) {
    const { items, counts, page } = await this.flows.subscribers(id, q);
    return ok(items, { count: items.length, counts, ...pageMeta(page) });
  }
}

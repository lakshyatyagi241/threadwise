import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { BroadcastsService } from './broadcasts.service';

/** WhatsApp broadcasts: one template sent to a list of contacts (TW-BCAST). */
@ApiTags('broadcasts')
@ActorKinds('user')
@Controller({ path: 'broadcasts', version: '2' })
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('bcast.broadcasts.create')
  @ApiOperation({
    summary: 'Create a broadcast (now or scheduled), one row per picked sender',
    description:
      'Checks, in order: plan feature and cap (422 PLAN_FEATURE_LOCKED / PLAN_LIMIT_REACHED), the body (400 VALIDATION_FAILED), ' +
      'an audience of at least one sendable contact (422 BCAST_NO_RECIPIENTS), send policy and wallet (422 BCAST_SEND_BLOCKED), ' +
      'the template (422 BCAST_TEMPLATE_NOT_FOUND / BCAST_TEMPLATE_NOT_ALLOWED) and the warmer (422 BCAST_WARMER_HOLD). ' +
      'The body is validated after the plan checks, as Reference did.',
  })
  async create(@Body() body: unknown) {
    return this.broadcasts.create(body);
  }
}

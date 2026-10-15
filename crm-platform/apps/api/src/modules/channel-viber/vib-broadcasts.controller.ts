import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createVibBroadcastSchema, type CreateVibBroadcastInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { VibBroadcastsService } from './vib-broadcasts.service';

/** Viber broadcasts: audience, compose, list, start, pause, retry, delete (TW-VIB-010 to 014). */
@ApiTags('viber')
@ActorKinds('user')
// Viber setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'viber', version: '2' })
export class VibBroadcastsController {
  constructor(private readonly broadcasts: VibBroadcastsService) {}

  @Get('channels/:id/users')
  @RequirePermission('viber.broadcasts.read')
  @ApiOperation({
    summary: 'The users a channel carries: the audience it can message (newest 1000)',
  })
  users(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.users(id);
  }

  @Get('broadcasts/compose')
  @RequirePermission('viber.broadcasts.read')
  @ApiOperation({ summary: 'Channels and Viber templates for the compose page' })
  compose() {
    return this.broadcasts.compose();
  }

  @Get('broadcasts')
  @RequirePermission('viber.broadcasts.read')
  @ApiOperation({ summary: 'The 50 newest broadcasts, with totals across all of them' })
  list() {
    return this.broadcasts.list();
  }

  @Post('broadcasts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('viber.broadcasts.manage')
  @ApiOperation({
    summary: 'Save a draft with a frozen recipient list',
    description:
      '422 VIB_BROADCAST_EMPTY without a message or file; 422 VIB_NO_RECIPIENTS when none of the users belong to the channel.',
  })
  create(@Body(zodPipe(createVibBroadcastSchema)) body: CreateVibBroadcastInput) {
    return this.broadcasts.create(body);
  }

  @Post('broadcasts/:id/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('viber.broadcasts.manage')
  @ApiOperation({
    summary: 'Start sending (a worker job sends it)',
    description:
      '422 VIB_CHANNEL_UNAVAILABLE for a missing or paused channel; 422 VIB_NOTHING_TO_SEND with nobody pending.',
  })
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.start(id);
  }

  @Post('broadcasts/:id/pause')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('viber.broadcasts.manage')
  @ApiOperation({ summary: 'Pause: back to draft, unsent users stay pending' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.pause(id);
  }

  @Post('broadcasts/:id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('viber.broadcasts.manage')
  @ApiOperation({
    summary: 'Put failed users back to pending',
    description: '422 VIB_NOTHING_TO_RETRY with none failed; 409 while sending.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.retry(id);
  }

  @Delete('broadcasts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('viber.broadcasts.manage')
  @ApiOperation({ summary: 'Delete a broadcast and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.broadcasts.remove(id);
  }
}

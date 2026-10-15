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
import { createLineBroadcastSchema, type CreateLineBroadcastInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { LineBroadcastsService } from './line-broadcasts.service';

/** LINE broadcasts: audience, compose, list, start, pause, retry, delete. */
@ApiTags('line')
@ActorKinds('user')
// LINE setup and broadcasts are entirely the extra-channels feature; the inbound webhook (separate, public controller) stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'line', version: '2' })
export class LineBroadcastsController {
  constructor(private readonly broadcasts: LineBroadcastsService) {}

  @Get('channels/:id/audience')
  @RequirePermission('line.broadcasts.read')
  @ApiOperation({
    summary:
      'The people a channel carries: the audience it can message (newest 500 direct threads)',
  })
  audience(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.audience(id);
  }

  @Get('broadcasts/compose')
  @RequirePermission('line.broadcasts.read')
  @ApiOperation({ summary: 'Channels and LINE templates for the compose page' })
  compose() {
    return this.broadcasts.compose();
  }

  @Get('broadcasts')
  @RequirePermission('line.broadcasts.read')
  @ApiOperation({ summary: 'The 50 newest broadcasts, with totals across all of them' })
  list() {
    return this.broadcasts.list();
  }

  @Post('broadcasts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('line.broadcasts.manage')
  @ApiOperation({
    summary: 'Save a draft with a frozen recipient list',
    description:
      '422 LINE_BROADCAST_EMPTY without a message or file; 422 LINE_NO_RECIPIENTS when none of the users belong to the channel.',
  })
  create(@Body(zodPipe(createLineBroadcastSchema)) body: CreateLineBroadcastInput) {
    return this.broadcasts.create(body);
  }

  @Post('broadcasts/:id/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.broadcasts.manage')
  @ApiOperation({
    summary: 'Start sending (a worker job sends it)',
    description:
      '422 LINE_CHANNEL_UNAVAILABLE for a missing or paused channel; 422 LINE_NOTHING_TO_SEND with nobody pending.',
  })
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.start(id);
  }

  @Post('broadcasts/:id/pause')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.broadcasts.manage')
  @ApiOperation({ summary: 'Pause: back to draft, unsent people stay pending' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.pause(id);
  }

  @Post('broadcasts/:id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('line.broadcasts.manage')
  @ApiOperation({
    summary: 'Put failed people back to pending (blocked ones stay blocked)',
    description: '422 LINE_NOTHING_TO_RETRY with none failed; 409 while sending.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.retry(id);
  }

  @Delete('broadcasts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('line.broadcasts.manage')
  @ApiOperation({ summary: 'Delete a broadcast and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.broadcasts.remove(id);
  }
}

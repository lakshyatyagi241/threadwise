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
import { createFbBroadcastSchema, type CreateFbBroadcastInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FbBroadcastsService } from './fb-broadcasts.service';

/** Messenger broadcasts: compose, list, start, pause, retry, delete (TW-FB-012 to 014). */
@ApiTags('facebook')
@ActorKinds('user')
@Controller({ path: 'facebook/broadcasts', version: '2' })
export class FbBroadcastsController {
  constructor(private readonly broadcasts: FbBroadcastsService) {}

  @Get('compose')
  @RequirePermission('fb.broadcasts.read')
  @ApiOperation({
    summary:
      'Connected Pages with who each can message right now (inside 24 hours), and the Facebook templates',
  })
  compose() {
    return this.broadcasts.compose();
  }

  @Get()
  @RequirePermission('fb.broadcasts.read')
  @ApiOperation({ summary: 'The 50 newest broadcasts, with totals across all of them' })
  list() {
    return this.broadcasts.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('fb.broadcasts.manage')
  @ApiOperation({
    summary: 'Save a draft with a frozen recipient list',
    description:
      '422 FB_PAGE_UNAVAILABLE for a Page that is not connected; 422 FB_BROADCAST_EMPTY without a message; 422 FB_NO_RECIPIENTS when none of the picked people are inside the 24 hour window.',
  })
  create(@Body(zodPipe(createFbBroadcastSchema)) body: CreateFbBroadcastInput) {
    return this.broadcasts.create(body);
  }

  @Post(':id/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.broadcasts.manage')
  @ApiOperation({
    summary: 'Start sending (a worker job sends it)',
    description:
      '422 FB_PAGE_UNAVAILABLE for a Page that is gone or revoked; 422 FB_NOTHING_TO_SEND with nobody pending.',
  })
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.start(id);
  }

  @Post(':id/pause')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.broadcasts.manage')
  @ApiOperation({ summary: 'Pause: back to draft, unsent people stay pending' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.pause(id);
  }

  @Post(':id/retry')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.broadcasts.manage')
  @ApiOperation({
    summary: 'Put failed people back to pending (blocked ones stay blocked)',
    description: '422 FB_NOTHING_TO_RETRY with none failed; 409 while sending.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.retry(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('fb.broadcasts.manage')
  @ApiOperation({ summary: 'Delete a broadcast and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.broadcasts.remove(id);
  }
}

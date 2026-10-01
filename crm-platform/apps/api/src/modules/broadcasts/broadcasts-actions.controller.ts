import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { BroadcastsActionsService } from './broadcasts-actions.service';

/** Delete, retry and export (TW-BCAST-037, 038, 040). */
@ApiTags('broadcasts')
@ActorKinds('user')
@Controller({ path: 'broadcasts', version: '2' })
export class BroadcastsActionsController {
  constructor(private readonly actions: BroadcastsActionsService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('bcast.broadcasts.delete')
  @ApiOperation({
    summary: 'Delete a scheduled or failed broadcast and its recipients',
    description: '422 BCAST_NOT_DELETABLE for any other status; a queued job for it is withdrawn.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.actions.delete(id);
  }

  @Post(':id/retry-failed')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bcast.broadcasts.retry')
  @ApiOperation({
    summary: 'Put the failed recipients back to pending and send them again',
    description:
      '409 BCAST_NOT_RETRYABLE while the broadcast is running or waiting; 422 BCAST_NO_FAILED_RECIPIENTS when nothing failed. ' +
      'Delivered recipients are never messaged again.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.retryFailed(id);
  }

  @Get(':id/export')
  @RequirePermission('bcast.broadcasts.export')
  @ApiOperation({ summary: 'Download the recipients as CSV (streamed)' })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.actions.export(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }
}

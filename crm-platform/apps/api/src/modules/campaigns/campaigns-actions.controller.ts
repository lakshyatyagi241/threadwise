import {
  Body,
  Controller,
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
import { resendCampaignSchema, type ResendCampaignInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignsActionsService } from './campaigns-actions.service';

/** Cancel, resume, send now, resend and export (WD-CAMP-016, 017, 020). */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns', version: '2' })
export class CampaignsActionsController {
  constructor(private readonly actions: CampaignsActionsService) {}

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Cancel: the run stops at its next recipient' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.cancel(id);
  }

  @Post(':id/resume')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Resume: the unsent recipients go on where the run stopped' })
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.resume(id);
  }

  @Post(':id/send-now')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({ summary: 'Send now: the schedule becomes now and the run starts' })
  sendNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.sendNow(id);
  }

  @Post(':id/resend')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.control')
  @ApiOperation({
    summary: 'Send a finished campaign again: to the failed (default), all, or selected recipients',
    description:
      '422 CAMP_NOT_RESENDABLE unless completed, failed or cancelled; 422 CAMP_NOTHING_TO_RESEND when nobody matches. ' +
      'Only the targeted recipients are reset.',
  })
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(resendCampaignSchema)) body: ResendCampaignInput,
  ) {
    return this.actions.resend(id, body);
  }

  @Get(':id/export')
  @RequirePermission('camp.campaigns.export')
  @ApiOperation({ summary: 'Download the recipients as CSV (streamed, newest first)' })
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

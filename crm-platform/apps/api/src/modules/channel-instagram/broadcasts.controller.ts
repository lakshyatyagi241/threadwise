import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  sendIgBroadcastSchema,
  sendIgComposerSchema,
  type SendIgBroadcastInput,
  type SendIgComposerInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BroadcastsService } from './broadcasts.service';

/** Reply-only sends to existing Instagram threads (WD-IG-013, 014). */
@ApiTags('instagram')
@ActorKinds('user')
@Controller({ path: 'instagram', version: '2' })
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get('compose')
  @RequirePermission('ig.broadcasts.manage')
  @ApiOperation({
    summary:
      'What the pickers need: the connected accounts with their threads, and the Instagram templates',
    description: 'Accounts are empty while the engine is off.',
  })
  compose() {
    return this.broadcasts.compose();
  }

  @Post('broadcasts')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.broadcasts.manage')
  @ApiOperation({
    summary: 'Send one message to existing Instagram threads (the broadcasts page)',
    description:
      '`{name}` becomes the person’s name. 200 `{sent, failed, errors}`; 422 IG_NOT_CONNECTED when the engine is off. At most 200 threads.',
  })
  send(@Body(zodPipe(sendIgBroadcastSchema)) body: SendIgBroadcastInput) {
    return this.broadcasts.sendBroadcast(body);
  }

  @Post('composer/send')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.broadcasts.manage')
  @ApiOperation({
    summary:
      'Send from the inbox composer to existing Instagram threads, optionally with a template',
    description:
      'A template’s body and buttons replace the typed text. 200 `{sent, failed, errors}`; 422 IG_NOT_CONNECTED when the engine is off. At most 200 threads.',
  })
  composer(@Body(zodPipe(sendIgComposerSchema)) body: SendIgComposerInput) {
    return this.broadcasts.sendFromComposer(body);
  }
}

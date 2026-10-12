import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  startMailboxConnectSchema,
  updateMailboxSchema,
  type StartMailboxConnectInput,
  type UpdateMailboxInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { MailConnectService } from './mail-connect.service';
import { MailboxesService } from './mailboxes.service';

/**
 * Gmail mailboxes of the workspace (TW-MAIL-019 to 023, 028). The whole channel is the `email_channel` plan feature, reads included.
 * Completing a connection is the public callback (`MailCallbackController`).
 */
@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/mailboxes', version: '2' })
export class MailboxesController {
  constructor(
    private readonly mailboxes: MailboxesService,
    private readonly connect: MailConnectService,
  ) {}

  @Get()
  @RequirePermission('mail.mailboxes.read')
  @ApiOperation({
    summary: "The workspace's connected mailboxes, oldest first, with the plan limit and use",
    description:
      'Never returns a token. `providerReady` is false while the platform operator has not entered the Google credentials.',
  })
  list() {
    return this.mailboxes.list();
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.mailboxes.manage')
  @ApiOperation({
    summary: 'Start connecting a Gmail mailbox',
    description:
      "Returns Google's consent URL (gmail.readonly + gmail.send, offline access) carrying a signed state good for ten minutes and bound to this workspace and admin. The browser goes there; Google then calls the public callback, which redirects back with `?email=<outcome>`. " +
      'Send `mailboxId` to reconnect an existing mailbox. 422 MAIL_NOT_CONFIGURED without platform credentials; 422 MAIL_MAILBOX_LIMIT at the plan limit.',
  })
  start(@Body(zodPipe(startMailboxConnectSchema)) body: StartMailboxConnectInput) {
    return this.connect.start(body);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('mail.mailboxes.manage')
  @ApiOperation({
    summary: 'Rename the mailbox (the name replies go out under)',
    description: 'Requires the `rowVersion` you read: 409 ROW_VERSION_CONFLICT otherwise.',
  })
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateMailboxSchema)) body: UpdateMailboxInput,
  ) {
    return this.mailboxes.rename(id, body);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('mail.mailboxes.manage')
  @ApiOperation({
    summary: 'Sync this mailbox now',
    description:
      'Queues a sync (the worker also syncs every connected mailbox once a minute). 409 MAIL_MAILBOX_UNAVAILABLE for a disconnected or needs-reconnect mailbox.',
  })
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailboxes.syncNow(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('mail.mailboxes.manage')
  @ApiOperation({
    summary: 'Disconnect the mailbox',
    description:
      'Revokes the grant at Google (best effort), wipes the stored tokens and switches the inbox channel to read-only. The conversations stay; reconnecting the same address reattaches them. Idempotent.',
  })
  async disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.mailboxes.disconnect(id);
  }
}

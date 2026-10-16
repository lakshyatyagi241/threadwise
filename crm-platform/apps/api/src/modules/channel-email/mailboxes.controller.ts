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
  connectImapMailboxSchema,
  startMailboxConnectSchema,
  testImapMailboxSchema,
  updateMailboxSchema,
  type ConnectImapMailboxInput,
  type StartMailboxConnectInput,
  type TestImapMailboxInput,
  type UpdateMailboxInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { MailConnectionTester } from './mail-connection-test.service';
import { MailConnectService } from './mail-connect.service';
import { MailboxesService } from './mailboxes.service';

@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/providers', version: '2' })
export class MailProvidersController {
  constructor(private readonly mailboxes: MailboxesService) {}

  @Get()
  @RequirePermission('mail.mailboxes.read', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'The email providers a mailbox can be connected with',
    description:
      'Each provider with how it is connected (`oauth` = sign-in popup, `password` = server settings and password) and whether the platform has set it up (`ready`, with the reason when not).',
  })
  list() {
    return this.mailboxes.providers();
  }
}

/**
 * Mailboxes of the workspace (TW-MAIL-019 to 023, 028). The whole channel is the `email_channel` plan feature, reads included.
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
    private readonly tester: MailConnectionTester,
  ) {}

  @Get()
  @RequirePermission('mail.mailboxes.read', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: "The workspace's connected mailboxes, oldest first, with the plan limit and use",
    description:
      "Never returns a token. `providerReady` is false while the platform operator has not entered the Google credentials. Shared mailboxes plus your own personal ones; an admin also gets other people's personal mailboxes as summary rows (`contentHidden: true`), or in full when the workspace policy lets admins read them. Anyone else never learns they exist.",
  })
  list() {
    return this.mailboxes.list();
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'Start connecting a mailbox by sign-in (Gmail, Microsoft 365)',
    description:
      "Returns the provider's consent URL (Gmail: gmail.readonly + gmail.send, offline access) for `provider` (default `google`), carrying a signed state good for ten minutes and bound to this workspace and admin. The browser goes there; Google then calls the public callback, which redirects back with `?email=<outcome>`. " +
      'Send `mailboxId` to reconnect an existing mailbox. 422 MAIL_NOT_CONFIGURED without platform credentials; 422 MAIL_MAILBOX_LIMIT at the plan limit; 422 MAIL_PROVIDER_UNSUPPORTED for a provider that is not a sign-in one; 422 MAIL_PERSONAL_DISABLED for `scope: personal` while the workspace has not enabled personal mailboxes; 403 MAIL_PERSONAL_NOT_ALLOWED when the policy does not let you connect one. A shared mailbox needs `mail.mailboxes.manage`, a personal one `mail.mailboxes.manage_personal` (or admin, by the policy); only the owner can reconnect a personal mailbox.',
  })
  start(@Body(zodPipe(startMailboxConnectSchema)) body: StartMailboxConnectInput) {
    return this.connect.start(body);
  }

  @Post('connect-imap')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'Connect an IMAP/SMTP mailbox with its server settings and password',
    description:
      'Both logins are verified before anything is stored: 422 MAIL_IMAP_AUTH_FAILED / MAIL_SMTP_AUTH_FAILED for a refused password, 422 MAIL_IMAP_CONNECT_FAILED for a server that cannot be reached, 422 MAIL_PROVIDER_UNSUPPORTED while the IMAP provider is not installed. The password is sealed and never returned. Send `mailboxId` to renew the login of an existing IMAP mailbox.',
  })
  async connectImap(@Body(zodPipe(connectImapMailboxSchema)) body: ConnectImapMailboxInput) {
    const row = await this.connect.connectWithPassword(body);
    return this.mailboxes.get(row.uuid);
  }

  @Post('test-imap')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'Test IMAP/SMTP settings without saving them',
    description:
      'Tries both servers with the settings in the body: connect, sign in and open the INBOX (IMAP); connect, greet and sign in (SMTP). Nothing is stored and nothing is sent. Both sides are always tried and each answers on its own (`ok`, the failed step, a reason code and a sentence), so a refused password never hides a wrong port. 429 MAIL_RATE_LIMITED after 6 tests a minute per workspace; 422 for a body that is not settings. The SSRF guard and certificate checks of connect apply.',
  })
  testImap(@Body(zodPipe(testImapMailboxSchema)) body: TestImapMailboxInput) {
    return this.tester.testNew(body);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'Test a connected IMAP/SMTP mailbox with its saved login',
    description:
      'Same answer as `test-imap`, using the login the mailbox already holds (it never leaves the server). Works on a mailbox that needs reconnecting, which is when it helps most. 409 MAIL_MAILBOX_UNAVAILABLE for a disconnected mailbox; 422 MAIL_PROVIDER_UNSUPPORTED for Gmail or Microsoft 365 (they have no password to test); acting on it needs the same right as Sync now.',
  })
  testStored(@Param('id', ParseUUIDPipe) id: string) {
    return this.tester.testStored(id);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
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
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
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
  @RequirePermission('mail.mailboxes.manage', 'mail.mailboxes.manage_personal')
  @ApiOperation({
    summary: 'Disconnect the mailbox',
    description:
      'Revokes the grant at Google (best effort), wipes the stored tokens and switches the inbox channel to read-only. The conversations stay; reconnecting the same address reattaches them. Idempotent.',
  })
  async disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.mailboxes.disconnect(id);
  }
}

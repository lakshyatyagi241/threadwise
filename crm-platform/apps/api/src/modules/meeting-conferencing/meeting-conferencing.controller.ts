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
import {
  conferencingConfirmInputSchema,
  conferencingStartInputSchema,
  connectedVideoProviderSchema,
  type ConferencingConfirmInput,
  type ConferencingStartInput,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ConferencingConnectService } from './conferencing-connect.service';
import { MeetingConferencingService } from './meeting-conferencing.service';

const providerPipe = zodPipe(connectedVideoProviderSchema);

/**
 * Video conferencing for a contact's meetings (BL-360..BL-362): what the Add meeting form may offer, a person's own Zoom / Teams
 * connection, and the retry of a link that failed. Everything here is about the signed-in person's own account or a meeting they may edit,
 * so it needs `record.contacts.update` (the key the form itself needs); installing the integration is the Marketplace's `market.apps.install`.
 * The completing callback is public and lives in `ConferencingCallbackController`.
 */
@ApiTags('meeting-conferencing')
@ActorKinds('user')
@Controller({ version: '2' })
export class MeetingConferencingController {
  constructor(
    private readonly conferencing: MeetingConferencingService,
    private readonly connect: ConferencingConnectService,
  ) {}

  @Get('conferencing/capabilities')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'The video options and calendar the Add meeting form may offer this person',
    description:
      'A video option is listed only when it is installed AND connected: Zoom or Teams (the workspace installed the listing and this person connected their own account), Teams through the Microsoft calendar, Google Meet through the Google calendar. ' +
      'An empty list means the form shows no video row; `canInstall`, `connectable` and `installable` decide whether it shows one quiet link to the integrations page.',
  })
  async capabilities() {
    return this.conferencing.capabilities();
  }

  @Get('conferencing/connections')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "This person's Zoom and Teams connections",
    description:
      '`not_installed`: the workspace has not installed the listing. `unavailable`: the platform has no OAuth app for it. `needs_reconnect`: the provider no longer honours the grant.',
  })
  async connections() {
    return this.connect.list();
  }

  @Post('conferencing/:provider/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "Start connecting this person's Zoom or Teams account",
    description:
      "Returns the provider's consent URL carrying a signed state good for ten minutes and bound to this workspace and person. 409 CONF_APP_NOT_INSTALLED when the workspace has not installed the listing; 422 CONF_NOT_CONFIGURED when the platform has no OAuth app.",
  })
  async start(
    @Param('provider', providerPipe) provider: ConnectedVideoProvider,
    @Body(zodPipe(conferencingStartInputSchema)) body: ConferencingStartInput,
  ) {
    return this.connect.start(provider, body);
  }

  @Post('conferencing/:provider/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Confirm a connection the provider sent the browser back from',
    description:
      'Exchanges the code in the ticket the callback issued, only for the person who pressed Connect, in the same workspace (403 CONF_CONFIRM_NOT_YOURS otherwise). 422 CONF_CONFIRM_INVALID for an expired or reused ticket.',
  })
  async confirm(
    @Param('provider', providerPipe) provider: ConnectedVideoProvider,
    @Body(zodPipe(conferencingConfirmInputSchema)) body: ConferencingConfirmInput,
  ) {
    return this.connect.confirm(provider, body);
  }

  @Delete('conferencing/:provider')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "Disconnect this person's Zoom or Teams account",
    description:
      'Deletes the stored tokens (the provider has no way to withdraw consent for an app: the person removes it in their account). Rooms already made stay; moving or deleting those meetings cannot reach them any more. Idempotent.',
  })
  async disconnect(@Param('provider', providerPipe) provider: ConnectedVideoProvider) {
    return this.connect.disconnect(provider);
  }

  @Post('contacts/:contactId/meetings/:id/conferencing/retry')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "Retry a meeting's video link or calendar entry",
    description:
      'Runs the step that failed again with the caller as the host of a room still to be made. The meeting is returned with its current state; a step that fails again is recorded on it, not thrown.',
  })
  async retry(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conferencing.retry(contactId, id);
  }
}

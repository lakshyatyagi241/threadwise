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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callCheckInputSchema,
  clickToCallInputSchema,
  contactCallsQuerySchema,
  createTelephonyConnectionInputSchema,
  ingestCallsInputSchema,
  logCallInputSchema,
  updateCallLogEntryInputSchema,
  updateCallLoggingSettingsInputSchema,
  updateTelephonyConnectionInputSchema,
  type CallCheckInput,
  type ClickToCallInput,
  type ContactCallsQuery,
  type CreateTelephonyConnectionInput,
  type IngestCallsInput,
  type LogCallInput,
  type RecordScope,
  type UpdateCallLogEntryInput,
  type UpdateCallLoggingSettingsInput,
  type UpdateTelephonyConnectionInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { CallIngestService } from './call-ingest.service';
import { CallLogEntriesService } from './call-log-entries.service';
import { CallLoggingSettingsService } from './call-logging-settings.service';
import { ClickToCallService } from './click-to-call.service';
import { ContactCallsService } from './contact-calls.service';
import { TelephonyConnectionsService } from './telephony-connections.service';

/**
 * Call logging (the calls that are not WhatsApp calls): "Log a call", the mobile app's reports, the telephony connections and the
 * click-to-call. `call.logs.create` logs and edits one's own entries; `call.logging.manage` runs the setup. Not plan-gated: recording
 * what happened on a phone is not a WhatsApp calling feature. See docs/api/call-logging.md.
 */
@ApiTags('calling')
@ActorKinds('user')
@Controller({ path: 'calls', version: '2' })
export class CallLoggingController {
  constructor(
    private readonly entries: CallLogEntriesService,
    private readonly ingest: CallIngestService,
    private readonly settings: CallLoggingSettingsService,
    private readonly connections: TelephonyConnectionsService,
    private readonly dialling: ClickToCallService,
  ) {}

  // --- log a call ------------------------------------------------------------------------------------------------------------------

  @Post('log')
  @Idempotent()
  @RequirePermission('call.logs.create')
  @ApiOperation({
    summary: 'Log a call that was not a WhatsApp call',
    description:
      'Needs the contact or the phone number. Optionally makes a follow-up task and returns a lifecycle stage suggestion (never applied). Logging is never refused by a consent rule.',
  })
  log(@Body(zodPipe(logCallInputSchema)) body: LogCallInput) {
    return this.entries.log(body);
  }

  @Patch('log/:id')
  @RequirePermission('call.logs.create')
  @ApiOperation({
    summary: 'Edit a call you logged, while the workspace edit window is open',
    description:
      'A call reported by a phone or a provider cannot be edited. 409 on a stale rowVersion.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCallLogEntryInputSchema)) body: UpdateCallLogEntryInput,
  ) {
    return this.entries.update(id, body);
  }

  @Delete('log/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('call.logs.create')
  @ApiOperation({ summary: 'Delete a call you logged, while the workspace edit window is open' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.entries.remove(id);
  }

  // --- the mobile app --------------------------------------------------------------------------------------------------------------

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.logs.create')
  @ApiOperation({
    summary: 'The mobile app reports up to 100 calls',
    description:
      'Idempotent on (deviceId, deviceCallId). A number that matches no contact is not stored unless the workspace creates contacts from unknown callers. Each entry answers on its own.',
  })
  ingestCalls(@Body(zodPipe(ingestCallsInputSchema)) body: IngestCallsInput) {
    return this.ingest.ingest(body);
  }

  // --- placing a call --------------------------------------------------------------------------------------------------------------

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.logs.create')
  @ApiOperation({
    summary: 'Would a call to this contact or number be allowed? (asked before dialling)',
    description:
      'A marketing call to a number on the Do-Not-Call list, or to someone who withdrew, answers deny. Places nothing. Logging the call afterwards is allowed whatever this says.',
  })
  check(@Body(zodPipe(callCheckInputSchema)) body: CallCheckInput) {
    return this.dialling.check(body);
  }

  @Post('click-to-call')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('call.logs.create')
  @ApiOperation({
    summary: 'Ask the workspace telephony provider to ring you, then the customer',
    description:
      'The finished call is logged by the provider callback (source web_click_to_call). 422 CONSENT_OPTED_OUT with reason on_dnc_list for a marketing call to a Do-Not-Call number.',
  })
  place(@Body(zodPipe(clickToCallInputSchema)) body: ClickToCallInput) {
    return this.dialling.place(body);
  }

  // --- setup -----------------------------------------------------------------------------------------------------------------------

  @Get('logging-settings')
  @RequirePermission('call.logs.create', 'call.logging.manage')
  @ApiOperation({ summary: 'The workspace call logging rules' })
  getSettings() {
    return this.settings.get();
  }

  @Put('logging-settings')
  @RequirePermission('call.logging.manage')
  @ApiOperation({
    summary: 'Change the workspace call logging rules (rowVersion after the first save)',
  })
  putSettings(
    @Body(zodPipe(updateCallLoggingSettingsInputSchema)) body: UpdateCallLoggingSettingsInput,
  ) {
    return this.settings.update(body);
  }

  @Get('telephony/providers')
  @RequirePermission('call.logging.manage')
  @ApiOperation({ summary: 'The telephony providers a connection can use' })
  providers() {
    return { rows: this.connections.providers() };
  }

  @Get('telephony/connections')
  @RequirePermission('call.logging.manage')
  @ApiOperation({ summary: 'The workspace telephony connections' })
  async listConnections() {
    return { rows: await this.connections.list() };
  }

  @Post('telephony/connections')
  @RequirePermission('call.logging.manage')
  @ApiOperation({
    summary: 'Add a telephony connection',
    description: 'Answers the callback secret ONCE; the provider signs its callbacks with it.',
  })
  createConnection(
    @Body(zodPipe(createTelephonyConnectionInputSchema)) body: CreateTelephonyConnectionInput,
  ) {
    return this.connections.create(body);
  }

  @Patch('telephony/connections/:id')
  @RequirePermission('call.logging.manage')
  @ApiOperation({ summary: 'Rename, re-number, enable or disable a telephony connection' })
  updateConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTelephonyConnectionInputSchema)) body: UpdateTelephonyConnectionInput,
  ) {
    return this.connections.update(id, body);
  }

  @Post('telephony/connections/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.logging.manage')
  @ApiOperation({ summary: 'Make a new callback secret (shown once); the old one stops working' })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.rotate(id);
  }

  @Delete('telephony/connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('call.logging.manage')
  @ApiOperation({ summary: 'Remove a telephony connection (the calls it reported stay)' })
  async removeConnection(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.connections.remove(id);
  }
}

/** A contact's calls, from both logs. */
@ApiTags('calling')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/calls', version: '2' })
export class ContactCallsController {
  constructor(private readonly calls: ContactCallsService) {}

  @Get()
  @RequirePermission('call.logs.read')
  @ApiOperation({
    summary: "A contact's calls: WhatsApp calls and logged calls, newest first",
    description:
      'Needs call.logs.read (its record scope says whose calls you see) and the right to read the contact. Filter by source.',
  })
  list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(contactCallsQuerySchema)) query: ContactCallsQuery,
    @GrantedScope('call.logs.read') scope: RecordScope,
  ) {
    return this.calls.list(contactId, query, scope);
  }
}

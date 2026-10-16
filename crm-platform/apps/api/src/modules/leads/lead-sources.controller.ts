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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLeadSourceSchema,
  listLeadEventsQuerySchema,
  previewLeadMappingSchema,
  sendTestLeadSchema,
  speedToLeadOptionsQuerySchema,
  updateLeadSourceSchema,
  type CreateLeadSourceInput,
  type ListLeadEventsQuery,
  type PreviewLeadMappingInput,
  type SendTestLeadInput,
  type SpeedToLeadOptionsQuery,
  type UpdateLeadSourceInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { LeadSourcesService } from './lead-sources.service';

/**
 * Lead sources (spec L-04, L-05, L-11, L-12). Every route needs the plan's `lead_sources` feature and the capability it names: `read` to
 * see sources and their events, `manage` to change them or to open anything that holds a lead's personal data (a stored payload, a
 * mapping preview, a test, a retry).
 */
@ApiTags('lead-sources')
@ActorKinds('user')
@RequirePlanFeature('lead_sources')
@Controller({ path: 'lead-sources', version: '2' })
export class LeadSourcesController {
  constructor(private readonly sources: LeadSourcesService) {}

  @Get()
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'List lead sources',
    description:
      'Newest first. Each source carries `needsAttention` (leads that need review or failed). Never the token or the shared secret.',
  })
  list() {
    return this.sources.list();
  }

  // Literal route first: ':id' would otherwise take it for an id.
  @Get('speed-to-lead/options')
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'What the first-message setting can choose from',
    description:
      'For one channel: the templates it can send and the connected senders. Names only, nothing of a contact.',
  })
  speedToLeadOptions(
    @Query(zodPipe(speedToLeadOptionsQuerySchema)) query: SpeedToLeadOptionsQuery,
  ) {
    return this.sources.speedToLeadOptions(query);
  }

  @Post()
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Create a webhook source',
    description:
      'Returns the URL token and `hookPath` ONCE: only a hash is kept. 409 LEAD_SOURCE_NAME_TAKEN, 422 PLAN_LIMIT_REACHED, 422 LEAD_MAPPING_INVALID / LEAD_DEFAULTS_INVALID.',
  })
  create(@Body(zodPipe(createLeadSourceSchema)) body: CreateLeadSourceInput) {
    return this.sources.create(body);
  }

  @Get(':id')
  @RequirePermission('leads.sources.read')
  @ApiOperation({ summary: 'One lead source' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.get(id);
  }

  @Patch(':id')
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Change a lead source',
    description:
      'Needs the `rowVersion` you read (409 ROW_VERSION_CONFLICT otherwise). `secret` sets the shared secret, `null` clears it, absent keeps it. `status: "paused"` makes the URL answer 404.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateLeadSourceSchema)) body: UpdateLeadSourceInput,
  ) {
    return this.sources.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Delete a lead source',
    description:
      'Its URL stops working and its stored events go with it. Contacts it created stay.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sources.remove(id);
  }

  @Post(':id/rotate-token')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Rotate the URL token',
    description: 'The old URL stops working at once. The new token is returned ONCE.',
  })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.rotateToken(id);
  }

  @Post(':id/mapping-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Preview a mapping',
    description:
      'What the (saved or draft) mapping makes of a payload: the posted one, a stored event, or the newest real one. Writes nothing; reading a stored payload is audited.',
  })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(previewLeadMappingSchema)) body: PreviewLeadMappingInput,
  ) {
    return this.sources.previewMapping(id, body);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Send a test lead',
    description:
      'Runs a sample (or the posted payload) through the real pipeline: a contact is created or matched, attributed, assigned and (if the source says so) given a deal. The event is flagged `isTest`; nobody is notified and no `contact.created` fires. 409 LEAD_SOURCE_PAUSED.',
  })
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendTestLeadSchema)) body: SendTestLeadInput,
  ) {
    return this.sources.sendTest(id, body);
  }

  @Get(':id/events')
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'Recent events of a source',
    description: 'Newest first, cursor paged. Filters: `status`, `isTest`. No payloads.',
  })
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listLeadEventsQuerySchema)) query: ListLeadEventsQuery,
  ) {
    return this.sources.listEvents(id, query);
  }

  @Get(':id/events/:eventId')
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'One event with its stored payload',
    description:
      'The payload is personal data: opening it writes an audit row. `payload` is null once purged.',
  })
  event(@Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.sources.getEvent(id, eventId);
  }

  @Post(':id/events/:eventId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Retry a lead that needs review or failed',
    description:
      "Re-runs the stored payload under the source's current settings. 409 LEAD_EVENT_NOT_RETRYABLE (any other status), 409 LEAD_PAYLOAD_PURGED, 409 LEAD_SOURCE_PAUSED.",
  })
  retry(@Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.sources.retryEvent(id, eventId);
  }
}

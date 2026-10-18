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
  createContactMeetingSchema,
  listContactMeetingsQuerySchema,
  updateContactMeetingSchema,
  type CreateContactMeetingInput,
  type ListContactMeetingsQuery,
  type UpdateContactMeetingInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactMeetingsService } from './contact-meetings.service';

/**
 * Contact detail page: Activities > Meetings sub-tab. Gated behind
 * record.contacts.* (not its own permission set).
 */
@ApiTags('contact-meetings')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/meetings', version: '2' })
export class ContactMeetingsController {
  constructor(private readonly meetings: ContactMeetingsService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: "List a contact's meetings",
    description:
      'Typed-in meetings and the mirror of every booking (source `booking`, with the appointment id and its current status). ' +
      '`when=upcoming|past|all` orders by start and filters; without it, most recently logged first.',
  })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listContactMeetingsQuerySchema)) query: ListContactMeetingsQuery,
  ) {
    return this.meetings.list(contactId, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Log a meeting' })
  async create(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zodPipe(createContactMeetingSchema)) body: CreateContactMeetingInput,
  ) {
    return this.meetings.create(contactId, body);
  }

  @Patch(':id')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Update a meeting',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateContactMeetingSchema)) body: UpdateContactMeetingInput,
  ) {
    return this.meetings.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Delete a meeting' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.meetings.remove(id);
  }
}

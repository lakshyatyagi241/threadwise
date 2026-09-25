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
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createContactNoteSchema,
  listContactNotesQuerySchema,
  updateContactNoteSchema,
  type CreateContactNoteInput,
  type ListContactNotesQuery,
  type UpdateContactNoteInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactNotesService } from './contact-notes.service';

/**
 * Contact detail page: Notes tab. Gated behind record.contacts.* (not its
 * own permission set) — a note only exists in the context of viewing/editing
 * a contact, same precedent as contact_identities.
 */
@ApiTags('contact-notes')
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/notes', version: '2' })
export class ContactNotesController {
  constructor(private readonly notes: ContactNotesService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's notes" })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listContactNotesQuerySchema)) query: ListContactNotesQuery,
  ) {
    return this.notes.list(contactId, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Add a note' })
  async create(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zodPipe(createContactNoteSchema)) body: CreateContactNoteInput,
  ) {
    return this.notes.create(contactId, body);
  }

  @Patch(':id')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Edit a note',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateContactNoteSchema)) body: UpdateContactNoteInput,
  ) {
    return this.notes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Delete a note' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.notes.remove(id);
  }
}

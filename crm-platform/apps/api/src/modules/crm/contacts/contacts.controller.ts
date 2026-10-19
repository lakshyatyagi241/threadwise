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
  attachContactTagSchema,
  bulkUpdateContactsSchema,
  contactSelectQuerySchema,
  createContactSchema,
  deleteContactQuerySchema,
  listContactsQuerySchema,
  listFieldHistoryQuerySchema,
  setContactAssigneeSchema,
  updateContactSchema,
  type AttachContactTagInput,
  type BulkUpdateContactsInput,
  type ContactSelectQuery,
  type CreateContactInput,
  type DeleteContactQuery,
  type ListContactsQuery,
  type ListFieldHistoryQuery,
  type RecordScope,
  type SetContactAssigneeInput,
  type UpdateContactInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { TagsService } from '../tags';
import { ContactsService } from './contacts.service';

/**
 * Staff-facing contacts API.
 *
 * Every route declares the capability it needs. The guard resolves the
 * caller's grants and hands the record scope to the handler, which passes it
 * to the service — so "Counsellor sees only their own contacts" is one
 * parameter, not a special code path.
 */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts', version: '2' })
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly tags: TagsService,
  ) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'List contacts (cursor paginated)' })
  async list(
    @Query(zodPipe(listContactsQuerySchema)) query: ListContactsQuery,
    @GrantedScope('record.contacts.read') scope: RecordScope,
  ) {
    return this.contacts.list(query, scope);
  }

  // Literal routes below MUST be registered before ':id' — Nest/Express
  // matches by declaration order, and a wildcard 1-segment ':id' route
  // would otherwise swallow e.g. GET /contacts/select-data as id="select-data".

  @Get('select-data')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'Lightweight rows for pickers/typeaheads' })
  async selectData(
    @Query(zodPipe(contactSelectQuerySchema)) query: ContactSelectQuery,
    @GrantedScope('record.contacts.read') scope: RecordScope,
  ) {
    return this.contacts.selectData(query, scope);
  }

  @Get('filter-values')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'Stages and statuses contacts hold, for the filter dropdowns' })
  async filterValues(@GrantedScope('record.contacts.read') scope: RecordScope) {
    return this.contacts.filterValues(scope);
  }

  @Get('assignees')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'Active staff users a contact can be assigned to' })
  async assignees() {
    return this.contacts.listAssignees();
  }

  @Post('bulk/update')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Bulk-edit contacts',
    description:
      'Each id is transactional independently — one bad id fails on its own, reported in `failed`, without affecting the rest of the batch.',
  })
  async bulkUpdate(@Body(zodPipe(bulkUpdateContactsSchema)) body: BulkUpdateContactsInput) {
    return this.contacts.bulkUpdate(body);
  }

  @Post('assignee')
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Set (or clear, with ownerId: null) the owner on multiple contacts' })
  async setAssignee(@Body(zodPipe(setContactAssigneeSchema)) body: SetContactAssigneeInput) {
    return this.contacts.setAssignee(body);
  }

  @Get(':id/send-window')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary:
      'The clock marketing messages to this contact are read on, and what the quiet hours say now',
    description:
      "The stored time zone and who set it, the zone a send would really use (the stored one, the number's country, the workspace fallback), the next allowed send time when it would be held, and how many messages already wait.",
  })
  async sendWindow(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.sendWindowOf(id);
  }

  @Get(':id')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'Get one contact by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.getByUuid(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.create')
  @ApiOperation({
    summary: 'Create a contact',
    description:
      'If the email or phone already resolves to a contact in this org, the existing contact is returned instead of creating a duplicate.',
  })
  async create(@Body(zodPipe(createContactSchema)) body: CreateContactInput) {
    return this.contacts.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Update a contact',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateContactSchema)) body: UpdateContactInput,
  ) {
    return this.contacts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.delete')
  @ApiOperation({
    summary: 'Delete a contact (hard delete) together with its conversation history',
    description:
      'By default the conversations, messages, media, files, call logs and recordings of the contact are erased with it. `eraseHistory=false` keeps the conversations and call logs without the identity of the person. Leads, deals, tasks and invoices stay as business records.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(deleteContactQuerySchema)) query: DeleteContactQuery,
  ): Promise<void> {
    await this.contacts.remove(id, { eraseHistory: query.eraseHistory });
  }

  @Get(':id/tags')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's tags" })
  async listTags(@Param('id', ParseUUIDPipe) id: string) {
    return this.tags.listForContact(id);
  }

  @Post(':id/tags')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Attach a tag to a contact, by id or by name',
    description:
      'A name that matches no tag creates one: that needs record.tags.create and counts against the plan tag limit. Attaching an already attached tag is a no-op.',
  })
  async attachTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(attachContactTagSchema)) body: AttachContactTagInput,
  ) {
    return this.tags.attachToContact(id, body);
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Detach a tag from a contact' })
  async removeTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ): Promise<void> {
    await this.tags.detachFromContact(id, tagId);
  }

  @Get(':id/field-history')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'Field-level change history for a contact',
    description: 'One entry per changed field, newest first — reads the existing audit trail.',
  })
  async fieldHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listFieldHistoryQuerySchema)) query: ListFieldHistoryQuery,
  ) {
    return this.contacts.listFieldHistory(id, query);
  }
}

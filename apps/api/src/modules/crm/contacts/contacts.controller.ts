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
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
  type CreateContactInput,
  type ListContactsQuery,
  type RecordScope,
  type UpdateContactInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
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
@Controller({ path: 'contacts', version: '1' })
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: 'List contacts (cursor paginated)' })
  async list(
    @Query(zodPipe(listContactsQuerySchema)) query: ListContactsQuery,
    @GrantedScope('record.contacts.read') scope: RecordScope,
  ) {
    return this.contacts.list(query, scope);
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
  @ApiOperation({ summary: 'Delete a contact (hard delete — see ADR-0009)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.contacts.remove(id);
  }
}

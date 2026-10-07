import { Body, Delete, Get, Param, Post, Put, Query, Patch } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1ContactsQuerySchema,
  v1CreateContactSchema,
  v1ListQuerySchema,
  v1UpdateContactSchema,
  type V1ContactsQuery,
  type V1CreateContact,
  type V1ListQuery,
  type V1UpdateContact,
} from '@crm/contracts';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../../http/v1-envelope';
import { V1ContactsService } from './contacts.service';

@V1Controller('contacts')
export class V1ContactsController {
  constructor(private readonly contacts: V1ContactsService) {}

  @Get()
  @RequireApiScope('contacts:read')
  @ApiOperation({ summary: 'List contacts, newest first, with an optional search' })
  async list(
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
    @Query(zodPipe(v1ContactsQuerySchema)) filter: V1ContactsQuery,
  ) {
    const res = await this.contacts.list({ ...paging, search: filter.search });
    return ok(res.data, pageMeta(res.page));
  }

  @Get(':id')
  @RequireApiScope('contacts:read')
  @ApiOperation({ summary: 'One contact' })
  async show(@Param('id') id: string) {
    return ok(await this.contacts.show(id));
  }

  @Post()
  @RequireApiScope('contacts:write')
  @ApiOperation({
    summary:
      'Create a contact; a phone or email that already belongs to a contact returns that contact',
  })
  async create(@Body(zodPipe(v1CreateContactSchema)) body: V1CreateContact) {
    const { contact, created } = await this.contacts.create(body);
    return ok(contact, { created });
  }

  @Put(':id')
  @RequireApiScope('contacts:write')
  @ApiOperation({ summary: 'Change only the fields sent' })
  async update(
    @Param('id') id: string,
    @Body(zodPipe(v1UpdateContactSchema)) body: V1UpdateContact,
    @Body() raw: unknown,
  ) {
    return ok(await this.contacts.update(id, body, raw));
  }

  @Patch(':id')
  @RequireApiScope('contacts:write')
  @ApiOperation({ summary: 'Alias of PUT: the verb is a partial update either way' })
  async patch(
    @Param('id') id: string,
    @Body(zodPipe(v1UpdateContactSchema)) body: V1UpdateContact,
    @Body() raw: unknown,
  ) {
    return ok(await this.contacts.update(id, body, raw));
  }

  @Delete(':id')
  @RequireApiScope('contacts:write')
  @ApiOperation({ summary: 'Delete a contact' })
  async remove(@Param('id') id: string) {
    return ok(await this.contacts.remove(id));
  }
}

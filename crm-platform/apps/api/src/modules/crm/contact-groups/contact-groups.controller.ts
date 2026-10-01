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
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createContactGroupSchema,
  listContactGroupsQuerySchema,
  setContactGroupsSchema,
  updateContactGroupSchema,
  type CreateContactGroupInput,
  type ListContactGroupsQuery,
  type SetContactGroupsInput,
  type UpdateContactGroupInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactGroupsService } from './contact-groups.service';

/** Contact groups: named lists a contact can be filed under (TW-CON-033..037). */
@ApiTags('contact-groups')
@ActorKinds('user')
@Controller({ path: 'contact-groups', version: '2' })
export class ContactGroupsController {
  constructor(private readonly groups: ContactGroupsService) {}

  @Get()
  @RequirePermission('record.contact-groups.read')
  @ApiOperation({ summary: 'List groups with their member counts (newest first)' })
  async list(@Query(zodPipe(listContactGroupsQuerySchema)) query: ListContactGroupsQuery) {
    return this.groups.list(query);
  }

  @Get(':id')
  @RequirePermission('record.contact-groups.read')
  @ApiOperation({ summary: 'Get one group by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.get(id);
  }

  @Post()
  @RequirePermission('record.contact-groups.create')
  @ApiOperation({
    summary: 'Create a group',
    description:
      'A name that already exists (any case) returns that group with 200 and `existing: true`, untouched.',
  })
  async create(
    @Body(zodPipe(createContactGroupSchema)) body: CreateContactGroupInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const created = await this.groups.create(body);
    res.status(created.existing ? HttpStatus.OK : HttpStatus.CREATED);
    return created;
  }

  @Patch(':id')
  @RequirePermission('record.contact-groups.update')
  @ApiOperation({
    summary: 'Rename a group or change its note and colour',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A name another group has is 409 CON_GROUP_NAME_TAKEN.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateContactGroupSchema)) body: UpdateContactGroupInput,
  ) {
    return this.groups.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-groups.delete')
  @ApiOperation({ summary: 'Delete a group; its contacts stay and lose only the membership' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.groups.remove(id);
  }
}

/** One contact's group membership. */
@ApiTags('contact-groups')
@ActorKinds('user')
@Controller({ path: 'contacts', version: '2' })
export class ContactGroupMembershipController {
  constructor(private readonly groups: ContactGroupsService) {}

  @Get(':id/groups')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's groups" })
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.groupsOfContact(id);
  }

  @Put(':id/groups')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "Replace a contact's groups",
    description: 'An explicit array: an empty one removes the last group too.',
  })
  async set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setContactGroupsSchema)) body: SetContactGroupsInput,
  ) {
    return this.groups.setGroupsOfContact(id, body);
  }
}

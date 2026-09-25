import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createContactActivitySchema,
  listContactActivitiesQuerySchema,
  type CreateContactActivityInput,
  type ListContactActivitiesQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactActivitiesService } from './contact-activities.service';

/**
 * Contact detail page: Activities > Activity Timeline sub-tab. Append-only —
 * no update/delete route. Gated behind record.contacts.* (not its own
 * permission set).
 */
@ApiTags('contact-activities')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/activities', version: '2' })
export class ContactActivitiesController {
  constructor(private readonly activities: ContactActivitiesService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's activity timeline" })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listContactActivitiesQuerySchema)) query: ListContactActivitiesQuery,
  ) {
    return this.activities.list(contactId, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Log a manual activity entry' })
  async create(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zodPipe(createContactActivitySchema)) body: CreateContactActivityInput,
  ) {
    return this.activities.create(contactId, body);
  }
}

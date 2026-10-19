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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addActivityOptionSchema,
  createActivityTypeSchema,
  reorderActivityOptionsSchema,
  setMeetingResultSchema,
  updateActivityTypeSchema,
  type AddActivityOptionInput,
  type CreateActivityTypeInput,
  type ReorderActivityOptionsInput,
  type SetMeetingResultInput,
  type UpdateActivityTypeInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ActivityTypesService } from './activity-types.service';
import { MeetingResultsService } from './meeting-results.service';

/**
 * Settings > Sales Activities. Reading the lists is open to anyone who uses the screens that show them (tasks, contacts, call logs) and to
 * the settings readers; changing anything needs `crm.activity_types.manage`.
 */
@ApiTags('activity-types')
@ActorKinds('user')
@Controller({ path: 'activity-types', version: '2' })
export class ActivityTypesController {
  constructor(private readonly activities: ActivityTypesService) {}

  @Get()
  @RequirePermission(
    'crm.activity_types.read',
    'record.tasks.read',
    'record.contacts.read',
    'call.logs.read',
    'call.logs.create',
  )
  @ApiOperation({
    summary: "List the workspace's activities with their switches, task types and outcomes",
    description:
      'Seeds the defaults (Task, Meeting, Phone, Email, Reminder, SMS, Chat) the first time a workspace without them reads this. ' +
      '`name` is null on a default activity, task type or outcome: the client shows its own localised word for the key.',
  })
  async list() {
    return this.activities.list();
  }

  @Post()
  @Idempotent()
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({ summary: 'Create a custom activity (behaves like a task, a meeting or a phone call)' })
  async create(@Body(zodPipe(createActivityTypeSchema)) body: CreateActivityTypeInput) {
    return this.activities.create(body);
  }

  @Patch(':id')
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({
    summary: "Edit an activity's switches (and a custom activity's name and icon)",
    description:
      'Requires the rowVersion you read. A default activity keeps its name; 409 ACTIVITY_DEFAULT_LOCKED. A switch the activity does not offer is 422 ACTIVITY_FEATURE_OFF.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateActivityTypeSchema)) body: UpdateActivityTypeInput,
  ) {
    return this.activities.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({ summary: 'Remove a custom activity (a default one cannot be removed)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.activities.remove(id);
  }

  @Post(':id/options')
  @Idempotent()
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({
    summary: 'Add a task type or an outcome at the end of its list',
    description: 'The same name as a removed one brings that one back. 409 ACTIVITY_NAME_TAKEN when the name is in the list.',
  })
  async addOption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addActivityOptionSchema)) body: AddActivityOptionInput,
  ) {
    return this.activities.addOption(id, body);
  }

  @Put(':id/options/order')
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({ summary: 'Set the order of a list: every current id once, in the new order' })
  async reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reorderActivityOptionsSchema)) body: ReorderActivityOptionsInput,
  ) {
    return this.activities.reorderOptions(id, body);
  }

  @Delete(':id/options/:optionId')
  @RequirePermission('crm.activity_types.manage')
  @ApiOperation({
    summary: 'Remove a task type or an outcome from its list',
    description: 'Soft delete: records that hold it still read it (`removed: true`); the pickers stop offering it.',
  })
  async removeOption(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ) {
    return this.activities.removeOption(id, optionId);
  }
}

/** The outcome and notes of a completed meeting, on the contact page's Meetings sub-tab. */
@ApiTags('activity-types')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/meeting-results', version: '2' })
export class MeetingResultsController {
  constructor(private readonly results: MeetingResultsService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "The outcomes of a contact's completed meetings" })
  async list(@Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.results.list(contactId);
  }

  @Put(':meetingId')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Complete a meeting with an outcome and notes, or change them',
    description:
      '409 ACTIVITY_COMPLETION_DISABLED when the Meeting activity does not allow completing; 409 ACTIVITY_EDIT_COMPLETED_DISABLED for `completedAt` when editing the completed time is off; 422 ACTIVITY_OPTION_INVALID for an outcome that was removed.',
  })
  async set(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body(zodPipe(setMeetingResultSchema)) body: SetMeetingResultInput,
  ) {
    return this.results.set(contactId, meetingId, body);
  }

  @Delete(':meetingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Reopen a meeting: its outcome and notes are dropped' })
  async clear(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ): Promise<void> {
    await this.results.clear(contactId, meetingId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setFollowUpSchema,
  setUncontactedSchema,
  snoozeFollowUpSchema,
  touchContactSchema,
  updateDuplicateSettingsSchema,
  updateFollowUpSettingsSchema,
  updateUncontactedSettingsSchema,
  type RecordScope,
  type SetFollowUpInput,
  type SetUncontactedInput,
  type SnoozeFollowUpInput,
  type TouchContactInput,
  type UpdateDuplicateSettingsInput,
  type UpdateFollowUpSettingsInput,
  type UpdateUncontactedSettingsInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactTouchService } from './contact-touch.service';
import { FollowUpService } from './follow-up.service';
import { LeadHandlingSettingsService } from './lead-handling-settings.service';

/** The workspace's lead handling settings (Settings > uncontacted leads, follow-ups, duplicate leads). Owner and Admin only. */
@ApiTags('lead-handling')
@ActorKinds('user')
@Controller({ path: 'lead-handling', version: '2' })
export class LeadHandlingController {
  constructor(private readonly settings: LeadHandlingSettingsService) {}

  @Get('settings')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary:
      'Every lead handling section with its own rowVersion (defaults for a section never saved)',
  })
  get() {
    return this.settings.get();
  }

  @Put('settings/uncontacted')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary: 'Save the uncontacted leads section',
    description:
      'Replaces the whole section. Needs the rowVersion read (absent on the first save). 409 ROW_VERSION_CONFLICT.',
  })
  updateUncontacted(
    @Body(zodPipe(updateUncontactedSettingsSchema)) body: UpdateUncontactedSettingsInput,
  ) {
    return this.settings.updateUncontacted(body);
  }

  @Put('settings/follow-ups')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary: 'Save the follow-ups section',
    description:
      'Replaces the whole section. Needs the rowVersion read (absent on the first save). 409 ROW_VERSION_CONFLICT, 422 for an invalid document.',
  })
  updateFollowUps(@Body(zodPipe(updateFollowUpSettingsSchema)) body: UpdateFollowUpSettingsInput) {
    return this.settings.updateFollowUps(body);
  }

  @Put('settings/duplicates')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary: 'Save the duplicate leads section',
    description:
      'Replaces the whole section. Needs the rowVersion read (absent on the first save). 409 ROW_VERSION_CONFLICT.',
  })
  updateDuplicates(
    @Body(zodPipe(updateDuplicateSettingsSchema)) body: UpdateDuplicateSettingsInput,
  ) {
    return this.settings.updateDuplicates(body);
  }
}

/**
 * What a person does to one contact's uncontacted marker. Registered before `ContactsController`: `contacts/:id/...` with a literal tail
 * would otherwise lose to its `:id` routes.
 */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts', version: '2' })
export class ContactTouchController {
  constructor(
    private readonly touch: ContactTouchService,
    private readonly followUps: FollowUpService,
  ) {}

  @Post(':id/touch')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'The person pressed Call, SMS, E-mail or WhatsApp on this contact',
    description:
      'Applies the workspace settings for a contact button (clears the uncontacted marker when that is switched on). Changes nothing with the default settings.',
  })
  press(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(touchContactSchema)) body: TouchContactInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.touch.touchByUuid(id, body.channel, scope);
  }

  @Put(':id/uncontacted')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Mark a contact as uncontacted or as contacted',
    description: 'Setting the state the contact is already in is a no-op.',
  })
  mark(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setUncontactedSchema)) body: SetUncontactedInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.touch.setByUuid(id, body.uncontacted, scope);
  }

  @Put(':id/follow-up')
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: "Set or move the contact's next follow-up (dueAt null = someday)",
    description:
      'A new follow-up is a task, so it also needs record.tasks.create. Moving or completing an existing one needs only the contact update permission and the contact scope.',
  })
  setFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setFollowUpSchema)) body: SetFollowUpInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.followUps.set(id, body.dueAt, scope);
  }

  @Post(':id/follow-up/snooze')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Move the follow-up to 1 day, 3 days or next week at the default alert time',
  })
  snooze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(snoozeFollowUpSchema)) body: SnoozeFollowUpInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.followUps.snooze(id, body.preset, scope);
  }

  @Post(':id/follow-up/done')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: "Complete the contact's follow-up" })
  done(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.followUps.done(id, scope);
  }

  @Delete(':id/follow-up')
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: "Remove the contact's follow-up" })
  removeFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.followUps.clear(id, scope);
  }
}

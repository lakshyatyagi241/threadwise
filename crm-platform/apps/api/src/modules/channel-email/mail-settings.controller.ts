import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateMailWorkspaceSettingsSchema,
  type UpdateMailWorkspaceSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { MailSettingsService } from './mail-settings.service';

/**
 * The email sharing policy (TW-MAIL-035): `GET` and `PUT` (also `PATCH`, same body) `/v2/email/settings`. Reading is open to everyone who
 * can use the hub (the connect option depends on it); writing is `mail.settings.manage` (Admin).
 */
@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/settings', version: '2' })
export class MailSettingsController {
  constructor(private readonly settings: MailSettingsService) {}

  @Get()
  @RequirePermission(
    'mail.mailboxes.read',
    'mail.mailboxes.manage_personal',
    'mail.settings.manage',
  )
  @ApiOperation({
    summary: 'The workspace email sharing policy (personal mailboxes)',
    description:
      'Personal mailboxes on or off, who may connect one (`admins` or `agents`), whether admins may read them. A workspace that never saved it gets the defaults (off, admins, no) with `rowVersion: 0`.',
  })
  get() {
    return this.settings.get();
  }

  @Put()
  @Idempotent()
  @RequirePermission('mail.settings.manage')
  @ApiOperation({
    summary: 'Save the email sharing policy',
    description:
      'Send the `rowVersion` you read (0 when never saved): 409 ROW_VERSION_CONFLICT otherwise. Omitted fields keep their value. Switching personal mailboxes off hides the connect option but never exposes existing personal mailboxes to anyone else.',
  })
  put(@Body(zodPipe(updateMailWorkspaceSettingsSchema)) body: UpdateMailWorkspaceSettingsInput) {
    return this.settings.update(body);
  }

  @Patch()
  @Idempotent()
  @RequirePermission('mail.settings.manage')
  @ApiOperation({ summary: 'Same as PUT (the contract names PATCH; both are accepted)' })
  patch(@Body(zodPipe(updateMailWorkspaceSettingsSchema)) body: UpdateMailWorkspaceSettingsInput) {
    return this.settings.update(body);
  }
}

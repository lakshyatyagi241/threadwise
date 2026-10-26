import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  reminderPackAdoptInputSchema,
  reminderPackKeySchema,
  reminderPackPreviewInputSchema,
  reminderReportQuerySchema,
  reminderTestSendInputSchema,
  type ReminderPackAdoptInput,
  type ReminderPackKey,
  type ReminderPackPreviewInput,
  type ReminderReportQuery,
  type ReminderTestSendInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { ReminderPacksService } from './reminder-packs.service';
import { ReminderReportService } from './reminder-report.service';
import { ReminderTestSendService } from './reminder-test-send';

/**
 * The reminder packs (BL-424): seven predefined sequences with their English and Hindi messages. Reading is open to anyone who can see
 * booking types; applying a pack changes a service, so it needs the right to update it (and the template rights for the WhatsApp
 * messages it creates).
 */
@ApiTags('appointment-reminder-packs')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointment-reminder-packs', version: '2' })
export class ReminderPacksController {
  constructor(private readonly packs: ReminderPacksService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'The seven reminder packs',
    description:
      'Each pack: its steps (when, channels, buttons, the switch it ships with), its languages and which of them are machine drafts.',
  })
  list() {
    return this.packs.list();
  }

  @Post(':key/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'What applying a pack to a service would do',
    description:
      "Per step: add, replace or unchanged, the service's current rule, the email text, the WhatsApp text, the template name and its live status. `needsConfirm` is true when a step would be replaced; `blocked` is `cap_exceeded` when the service would pass five timed steps. Nothing is written.",
  })
  preview(
    @Param('key', zodPipe(reminderPackKeySchema)) key: ReminderPackKey,
    @Body(zodPipe(reminderPackPreviewInputSchema)) body: ReminderPackPreviewInput,
  ) {
    return this.packs.preview(key, body);
  }

  @Post(':key/adopt')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Apply a pack to a service',
    description:
      "Creates, once per workspace, the email messages (active at once) and the WhatsApp templates (draft, then sent to Meta unless `submitToMeta` is false), then saves the service's steps. 409 when a step would be replaced and `confirmReplace` is not true; 422 when the cap of five timed steps would be passed. Until a template is approved the step sends by email.",
  })
  adopt(
    @Param('key', zodPipe(reminderPackKeySchema)) key: ReminderPackKey,
    @Body(zodPipe(reminderPackAdoptInputSchema)) body: ReminderPackAdoptInput,
  ) {
    return this.packs.adopt(key, body);
  }
}

/** What the sequences did per service and step (BL-429). */
@ApiTags('appointment-reminder-report')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointment-reminder-report', version: '2' })
export class ReminderReportController {
  constructor(private readonly report: ReminderReportService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary:
      'Sent, delivered, failed and skipped per service and step, with the confirmation, cancel and no-show rates',
    description:
      'Window: the due time of the steps, default the last 30 days. Filter by `bookingTypeId`. A rate is null when nothing was sent. Counts only: no contact, address or message.',
  })
  get(@Query(zodPipe(reminderReportQuerySchema)) query: ReminderReportQuery) {
    return this.report.report(query);
  }
}

/** The email test of one step. */
@ApiTags('booking-types')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'booking-types', version: '2' })
export class ReminderTestSendController {
  constructor(private readonly tests: ReminderTestSendService) {}

  @Post(':id/reminders/:reminderId/test-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary:
      "Send a step as a test email to the signed-in user's own address, or to one address they type",
    description:
      'Email only (there is no WhatsApp test). Sample values; the subject starts with [Test]. `to` is optional (default: the signed-in user). At most 10 tests per workspace per hour (429). The worker sends it and the result arrives as a notification. 404 when the step does not belong to the service.',
  })
  testEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reminderId', ParseUUIDPipe) reminderId: string,
    @Body(zodPipe(reminderTestSendInputSchema)) body: ReminderTestSendInput,
  ) {
    return this.tests.request(id, reminderId, body.to);
  }
}

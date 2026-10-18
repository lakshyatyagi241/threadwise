import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  calendarConnectStartInputSchema,
  selectCalendarInputSchema,
  type CalendarConnectStartInput,
  type SelectCalendarInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';

/**
 * Connecting Google Calendar (TW-APPT-028). Editing the connection is part of editing booking configuration, so it needs
 * `record.booking-types.update`; who may see whether a calendar is connected is `GET /appointments/calendar` (`record.appointments.read`).
 * The completing callback is public and lives in `GoogleCalendarCallbackController`.
 *
 * The paths are two segments below `appointments/`, so they cannot be taken for `appointments/:id`.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments/calendar/google', version: '2' })
export class GoogleCalendarController {
  constructor(private readonly google: GoogleCalendarConnectService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: "Start connecting the workspace's Google Calendar",
    description:
      "Returns Google's consent URL (calendar scopes, offline access) carrying a signed state good for ten minutes and bound to this workspace and admin. The browser goes there; Google then calls the public callback. 422 APPT_CALENDAR_NOT_CONFIGURED when the platform has no Google OAuth client.",
  })
  async start(@Body(zodPipe(calendarConnectStartInputSchema)) body: CalendarConnectStartInput) {
    return this.google.start(body);
  }

  @Get('calendars')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'The calendars the connected account can write to',
    description:
      '409 APPT_CALENDAR_NOT_CONNECTED when nothing is connected or it needs reconnecting; 502 APPT_CALENDAR_PROVIDER_FAILED when Google does not answer.',
  })
  async calendars() {
    return this.google.calendars();
  }

  @Get('spreadsheets')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'The spreadsheets of the connected Google account, for the booking type\'s sheet picker',
    description:
      '409 APPT_CALENDAR_NOT_CONNECTED when nothing is connected, it needs reconnecting or the Drive file list permission was not given; 502 APPT_CALENDAR_PROVIDER_FAILED when Google does not answer.',
  })
  async spreadsheets() {
    return this.google.spreadsheets();
  }

  @Put('calendar')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Choose which calendar bookings are written to',
    description:
      'The id must be one of the calendars listed above. Events already written stay in the calendar they were written to.',
  })
  async select(@Body(zodPipe(selectCalendarInputSchema)) body: SelectCalendarInput) {
    return this.google.selectCalendar(body);
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Disconnect Google Calendar',
    description:
      'Revokes the grant at Google (best effort: an unreachable Google does not block it), then deletes the stored tokens. Events already written stay in the calendar. Idempotent.',
  })
  async disconnect() {
    return this.google.disconnect();
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  calendarCallbackQuerySchema,
  calendarConnectStartInputSchema,
  microsoftCalendarConfirmInputSchema,
  selectCalendarInputSchema,
  setCalendarProviderInputSchema,
  type CalendarCallbackQuery,
  type CalendarConnectStartInput,
  type MicrosoftCalendarConfirmInput,
  type SelectCalendarInput,
  type SetCalendarProviderInput,
} from '@crm/contracts';
import { ActorKinds, Public, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { CalendarOverviewService } from './calendar-overview.service';
import { MicrosoftCalendarConnectService } from './microsoft-calendar-connect.service';

/**
 * Connecting Outlook / Microsoft 365 (BL-035), modelled on `GoogleCalendarController`. Editing the connection is part of editing booking
 * configuration, so it needs `record.booking-types.update`. The completing callback is public and lives in
 * `MicrosoftCalendarCallbackController`.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments/calendar/microsoft', version: '2' })
export class MicrosoftCalendarController {
  constructor(private readonly microsoft: MicrosoftCalendarConnectService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: "Start connecting the workspace's Outlook / Microsoft 365 calendar",
    description:
      "Returns Microsoft's consent URL (read and write calendars, offline access) carrying a signed state good for ten minutes and bound to this workspace and admin. 422 APPT_CALENDAR_NOT_CONFIGURED when the platform has no Microsoft app.",
  })
  start(@Body(zodPipe(calendarConnectStartInputSchema)) body: CalendarConnectStartInput) {
    return this.microsoft.start(body);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Confirm the connection Microsoft just returned',
    description:
      'The page the callback sent the browser to posts the one-time ticket from the address. Only the admin who pressed Connect, in that workspace, can use it (403 APPT_CALENDAR_CONFIRM_NOT_YOURS); the code is exchanged only now. 410 APPT_CALENDAR_CONFIRM_INVALID for an expired or spent ticket.',
  })
  confirm(@Body(zodPipe(microsoftCalendarConfirmInputSchema)) body: MicrosoftCalendarConfirmInput) {
    return this.microsoft.confirm(body);
  }

  @Get('calendars')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'The calendars the connected Microsoft account can write to',
    description:
      '409 APPT_CALENDAR_NOT_CONNECTED when nothing is connected or it needs reconnecting; 502 APPT_CALENDAR_PROVIDER_FAILED when Microsoft does not answer.',
  })
  calendars() {
    return this.microsoft.calendars();
  }

  @Put('calendar')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Choose which Microsoft calendar bookings are written to',
    description:
      'The id must be one of the calendars listed above. Events already written stay where they are.',
  })
  select(@Body(zodPipe(selectCalendarInputSchema)) body: SelectCalendarInput) {
    return this.microsoft.selectCalendar(body);
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Disconnect Outlook / Microsoft 365',
    description:
      "Deletes the stored tokens. Microsoft offers no way to withdraw a person's consent from the app side: they remove it at myaccount.microsoft.com. Events already written stay in the calendar. Idempotent.",
  })
  disconnect() {
    return this.microsoft.disconnect();
  }
}

/**
 * Where Microsoft sends the browser after the consent screen. Unauthenticated by design (a browser redirect from Microsoft carries no
 * token): the signed `state` that `POST .../start` issued is the credential, and is checked before anything else happens. Always answers
 * with a redirect to the web app, never with Microsoft's data; the code in the address is kept out of caches and referrers. It exchanges
 * nothing: see `MicrosoftCalendarConnectService`.
 */
@ApiTags('appointments')
@Public()
@Controller({ path: 'public/appointments/calendar/microsoft', version: '2' })
export class MicrosoftCalendarCallbackController {
  constructor(private readonly microsoft: MicrosoftCalendarConnectService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: "Microsoft's redirect after consent",
    description:
      'Verifies the state and redirects to the settings page with `?calendar=microsoft_confirm&ticket=...` (to be confirmed by the same admin) or `?calendar=denied|failed|expired|not_configured`.',
  })
  async callback(
    @Query(zodPipe(calendarCallbackQuerySchema)) query: CalendarCallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.microsoft.callback(query));
  }
}

/**
 * The view across providers, and the one choice that spans them: which connected calendar receives bookings. The overview is as visible as
 * the calendar status (`record.appointments.read`); the choice is booking configuration.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments/calendar', version: '2' })
export class CalendarProvidersController {
  constructor(private readonly overview: CalendarOverviewService) {}

  @Get('overview')
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: 'Every calendar provider of the workspace and where bookings are written',
    description:
      'Busy time is read from every connected calendar; a booking is written to exactly one (`writeProvider`).',
  })
  get() {
    return this.overview.overview();
  }

  @Put('provider')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Choose which connected calendar receives bookings',
    description:
      '`{ provider: "google" | "microsoft" | null }`; null goes back to automatic (Google when usable, else Microsoft). 409 APPT_CALENDAR_NOT_CONNECTED when that provider is not connected. Takes effect for the next change to a booking, and is applied to upcoming bookings by the back-fill.',
  })
  set(@Body(zodPipe(setCalendarProviderInputSchema)) body: SetCalendarProviderInput) {
    return this.overview.setProvider(body);
  }

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Write the upcoming bookings that are missing from the calendar',
    description:
      'Queues the same job a connect, a reconnect or a change of provider queues: confirmed bookings that have not ended and start within 90 days, and whose event is not in the calendar bookings go to, get one. Idempotent. `{ queued: false }` when no calendar is connected.',
  })
  backfill() {
    return this.overview.requestBackfill();
  }
}

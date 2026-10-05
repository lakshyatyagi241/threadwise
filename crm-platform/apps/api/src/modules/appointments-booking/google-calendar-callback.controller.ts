import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { calendarCallbackQuerySchema, type CalendarCallbackQuery } from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';

/**
 * Where Google sends the browser after the consent screen (WD-APPT-028). Unauthenticated by design (it is a browser redirect from
 * Google, with no token): the signed `state` that `POST /appointments/calendar/google/start` issued is the credential, and is checked
 * before anything else happens. Always answers with a redirect to the web app, never with Google's data; the code in the address is
 * kept out of caches and referrers.
 */
@ApiTags('appointments')
@Public()
@Controller({ path: 'public/appointments/calendar/google', version: '2' })
export class GoogleCalendarCallbackController {
  constructor(private readonly google: GoogleCalendarConnectService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: "Google's redirect after consent",
    description:
      'Verifies the state, exchanges the code, stores the sealed refresh token and redirects to the settings page with `?calendar=connected|denied|failed|expired|not_configured|missing_scope`.',
  })
  async callback(
    @Query(zodPipe(calendarCallbackQuerySchema)) query: CalendarCallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.google.callback(query));
  }
}

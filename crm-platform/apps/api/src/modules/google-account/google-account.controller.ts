import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ERROR_CODES,
  googleConnectInputSchema,
  type CalendarListResponse,
  type GoogleAccountResponse,
  type GoogleConnectInput,
  type GoogleConnectResponse,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { GoogleCalendarConnectService } from '../appointments-booking';

const DEFAULT_RETURN = '/google-account';

/**
 * The workspace's Google account (`/google-account`, TW-GACC-001 to 006): the one connection the appointments calendar and the flow
 * builder's Google nodes share. Reference gated the page on the workspace admin role; here the two permissions are
 * `google.account.read` and `google.account.manage`, both held by the admin presets. The consent callback is the public route of the
 * appointments controller (the address the operator registered at Google), and it returns the browser to the page that asked.
 */
@ApiTags('google-account')
@ActorKinds('user')
@Controller({ path: 'google-account', version: '2' })
export class GoogleAccountController {
  constructor(private readonly google: GoogleCalendarConnectService) {}

  @Get()
  @RequirePermission('google.account.read')
  @ApiOperation({
    summary: "The workspace's Google account",
    description:
      'State (`unavailable` when the platform has no Google client, `disconnected`, `connected`, `needs_reconnect`), the account email, which capabilities the grant covers, and the last failure a feature met. Never returns a token.',
  })
  async get(): Promise<GoogleAccountResponse> {
    return this.google.account();
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('google.account.manage')
  @ApiOperation({
    summary: 'Start connecting Google, or add permissions to the connected account',
    description:
      "Returns Google's consent URL for the ticked capabilities (offline access, `include_granted_scopes`, a signed state good for ten minutes bound to this workspace and admin). 422 GOOGLE_ACCOUNT_NOT_CONFIGURED when the platform has no Google OAuth client.",
  })
  async connect(
    @Body(zodPipe(googleConnectInputSchema)) body: GoogleConnectInput,
  ): Promise<GoogleConnectResponse> {
    const started = await this.google.begin(body.capabilities, body.returnTo ?? DEFAULT_RETURN);
    if (!started) {
      throw new AppError(
        ERROR_CODES.GOOGLE_ACCOUNT_NOT_CONFIGURED,
        'Google is not set up for this platform. Ask your platform administrator to add the Google OAuth client.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return started;
  }

  @Get('calendars')
  @RequirePermission('google.account.read')
  @ApiOperation({
    summary: 'The calendars the connected account can write to',
    description:
      '409 APPT_CALENDAR_NOT_CONNECTED when the calendar permission is not granted or the account needs reconnecting; 502 APPT_CALENDAR_PROVIDER_FAILED when Google does not answer.',
  })
  async calendars(): Promise<CalendarListResponse> {
    return this.google.calendars();
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('google.account.manage')
  @ApiOperation({
    summary: 'Disconnect Google',
    description:
      'Revokes the grant at Google (best effort: an unreachable Google does not block it), then deletes the stored tokens. Everything that uses the account stops (calendar sync, Sheets, Docs, Forms and Meet nodes) until it is connected again. Idempotent.',
  })
  async disconnect(): Promise<GoogleAccountResponse> {
    await this.google.disconnect();
    return this.google.account();
  }
}

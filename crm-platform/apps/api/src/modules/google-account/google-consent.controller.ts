import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GoogleConsentRequest, GoogleConsentResult } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { GoogleConsentService } from '../appointments-booking';

/**
 * The confirmation of a Google connection (TW-GACC-010), the page the OAuth callback sends the browser to. Authenticated-only on purpose
 * (no permission key): the person who pressed Connect may have held `google.account.manage` or only the booking-settings key (the calendar
 * card), and what decides is that the SAME signed-in person, in the same workspace, confirms. The service refuses anyone else.
 */
@ApiTags('google-account')
@ActorKinds('user')
@Controller({ path: 'google-account/consent', version: '2' })
export class GoogleConsentController {
  constructor(private readonly consent: GoogleConsentService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'What is about to be connected (Google email, workspace, permissions)',
    description:
      '403 GOOGLE_CONSENT_NOT_YOURS (and the parked grant is withdrawn) when someone else started it; 404 GOOGLE_CONSENT_NOT_FOUND; 409 GOOGLE_CONSENT_USED; 410 GOOGLE_CONSENT_EXPIRED.',
  })
  details(@Param('id', ParseUUIDPipe) id: string): Promise<GoogleConsentRequest> {
    return this.consent.details(id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connect the Google account (stored only now, once)',
    description: 'Same refusals as the read; a second confirmation is 409 GOOGLE_CONSENT_USED.',
  })
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<GoogleConsentResult> {
    return this.consent.confirm(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Do not connect: the parked grant is dropped' })
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<GoogleConsentResult> {
    return this.consent.cancel(id);
  }
}

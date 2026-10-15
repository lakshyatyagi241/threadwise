import { Controller, Get, Header, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { Throttle } from '../platform-infrastructure';
import { ConsentUnsubscribeService } from './consent-unsubscribe.service';

/**
 * The public side of the email unsubscribe link (BL-141). No login: the signed token in the path is the only credential, and it can
 * only withdraw email marketing for one contact. The web page `/u/<token>` calls these; mail clients POST to the same URL for
 * one-click unsubscribe (RFC 8058; the body is not needed to act). Throttled per IP.
 */
@ApiTags('contact-consent')
@Public()
@Controller({ path: 'public/consent/unsubscribe', version: '2' })
export class ConsentUnsubscribeController {
  constructor(private readonly unsub: ConsentUnsubscribeService) {}

  @Get(':token')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'ip' })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Is this unsubscribe link valid, and has the person already unsubscribed?',
  })
  status(@Param('token') token: string) {
    return this.unsub.status(token);
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 20, windowSeconds: 60, by: 'ip' })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Unsubscribe from marketing emails (also the RFC 8058 one-click target)',
    description:
      'Writes a withdrawn event (channel email, purpose marketing, source contact_request). Idempotent.',
  })
  unsubscribe(@Param('token') token: string) {
    return this.unsub.unsubscribe(token);
  }
}

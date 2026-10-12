import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { mailCallbackQuerySchema, type MailCallbackQuery } from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MailConnectService } from './mail-connect.service';

/**
 * Where Google sends the browser after the consent screen (TW-MAIL-020). Unauthenticated by design (it is a browser redirect from Google,
 * with no token): the signed `state` that `POST /email/mailboxes/connect` issued is the credential, and is checked before anything else
 * happens. Always answers with a redirect to the web app, never with Google's data; the code in the address is kept out of caches and
 * referrers.
 */
@ApiTags('email')
@Public()
@Controller({ path: 'public/email/google', version: '2' })
export class MailCallbackController {
  constructor(private readonly connect: MailConnectService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: "Google's redirect after consent",
    description:
      'Verifies the state, exchanges the code, stores the sealed tokens and redirects to the page the admin came from with `?email=connected|denied|missing_scope|limit|not_configured|wrong_account|failed`.',
  })
  async callback(
    @Query(zodPipe(mailCallbackQuerySchema)) query: MailCallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.connect.callback(query));
  }
}

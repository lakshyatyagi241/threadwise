import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  conferencingCallbackQuerySchema,
  connectedVideoProviderSchema,
  type ConferencingCallbackQuery,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { Throttle } from '../platform-infrastructure';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ConferencingConnectService } from './conferencing-connect.service';

/**
 * Where Zoom or Microsoft sends the browser after the consent screen (BL-360). Unauthenticated by design (it is a browser redirect from the
 * provider, with no token): the signed `state` that `POST /conferencing/:provider/start` issued is the credential, and is checked before
 * anything else happens. Always answers with a redirect to the web app, never with provider data; the code in the address is kept out of
 * caches and referrers.
 */
@ApiTags('meeting-conferencing')
@Public()
@Controller({ path: 'public/conferencing', version: '2' })
export class ConferencingCallbackController {
  constructor(private readonly connect: ConferencingConnectService) {}

  @Get(':provider/callback')
  @Throttle({ limit: 300, windowSeconds: 60, by: 'ip' })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: "The provider's redirect after consent",
    description:
      'Verifies the state and redirects to the connection page with `?video=confirm&ticket=...` (the person then confirms) or `?video=denied|failed|expired|not_configured`. Nothing is exchanged or stored here.',
  })
  async callback(
    @Param('provider', zodPipe(connectedVideoProviderSchema)) provider: ConnectedVideoProvider,
    @Query(zodPipe(conferencingCallbackQuerySchema)) query: ConferencingCallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.connect.callback(provider, query));
  }
}

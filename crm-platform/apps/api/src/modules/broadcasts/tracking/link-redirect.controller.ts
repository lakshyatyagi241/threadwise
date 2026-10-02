import { Controller, Get, Headers, Ip, Param, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../common/decorators';
import { LinkRedirectService } from './link-redirect.service';

/** `GET /r/<token>`: the short link a recipient taps. Public, no sign-in, not versioned (the link is printed in messages). */
@ApiExcludeController()
@Controller({ path: 'r', version: VERSION_NEUTRAL })
export class LinkRedirectController {
  constructor(private readonly links: LinkRedirectService) {}

  @Public()
  @Get(':token')
  async go(
    @Param('token') token: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.links.go(token, ip, userAgent ?? '');
    res.redirect(302, url);
  }
}

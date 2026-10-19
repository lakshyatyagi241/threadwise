import { Controller, Get, Param, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { WaChatLinksService } from './wa-chat-links.service';
import { WaLinkRedirectThrottle } from './wa-link-redirect-throttle';

/**
 * The public click-to-chat redirect (Reference `GET /l/{slug}`; docs/threadwise-port/inventory/forms-links-groups.md
 * TW-WFL-017). No sign-in, no CSRF, no `/v2` prefix — this is a link people click from ads, bios and QR codes.
 * 404 unknown slug, 410 paused/expired, else bumps the click counter and redirects (302) to `wa.me`.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'l', version: VERSION_NEUTRAL })
export class WaChatLinkRedirectController {
  constructor(
    private readonly links: WaChatLinksService,
    private readonly throttle: WaLinkRedirectThrottle,
  ) {}

  @Get(':slug')
  async redirect(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    if (!(await this.throttle.allow(req.ip))) {
      res.status(429).send('Too many requests');
      return;
    }
    const result = await this.links.resolvePublic(slug);
    if ('notFound' in result) {
      res.status(404).send('This link does not exist.');
      return;
    }
    if ('gone' in result) {
      res.status(410).send('This link is no longer active.');
      return;
    }
    res.redirect(302, result.waUrl);
  }
}

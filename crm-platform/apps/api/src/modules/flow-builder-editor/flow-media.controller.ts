import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { FlowMediaService } from './flow-media.service';

/**
 * Serves a flow's uploaded media at the public URL the node stores (TW-FLB-027). Public on purpose: the runtime and the
 * recipient's WhatsApp client fetch it without a session. The path is `<organization uuid>/<server-generated name>`; the
 * name carries 96 random bits, and the store refuses any path that is not exactly that shape.
 */
@ApiTags('flows')
@Public()
@Controller({ path: 'flow-media', version: '2' })
export class FlowMediaController {
  constructor(private readonly media: FlowMediaService) {}

  @Get(':org/:name')
  @ApiExcludeEndpoint()
  async file(@Param('org') org: string, @Param('name') name: string, @Res() res: Response) {
    const f = await this.media.read(org, name);
    if (!f) {
      res
        .status(404)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' });
      return;
    }
    res
      .status(200)
      .setHeader('content-type', f.mime)
      .setHeader('x-content-type-options', 'nosniff')
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .setHeader('content-security-policy', "default-src 'none'; sandbox")
      .send(f.data);
  }
}

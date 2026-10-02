import { Controller, Get, Inject, Optional, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream';
import { ActorKinds } from '../../../../common/decorators';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import { ChatMediaStore, MediaRangeError } from './chat-media.store';
import { MediaTokenService } from './media-token.service';
import { isInlineMime, servableMime } from './media-types';
import { MEDIA_ACCESS_POLICY, type ChatMediaAccessPolicy } from './media.ports';

/** `bytes=500-` and `bytes=500-999`. A suffix range (`bytes=-500`) or several ranges are answered with the whole file, which RFC 9110 allows. */
function parseRange(header: string | undefined): { start: number; end?: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === '' ? undefined : Number(m[2]);
  return end !== undefined && end < start ? undefined : { start, end };
}

/** A download name as the `filename*` parameter, so any character in it is safe in a header. */
const contentDisposition = (inline: boolean, name: string) =>
  `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/**
 * Where a stored media file is read (`GET /v2/media/:token`). Never a public URL: the caller needs a session, the token must
 * have been minted for THIS person in THIS workspace within the last minutes, the object must be this workspace's, and the
 * domain's own access policy (when bound) must still agree. Every refusal is the same 404, so the route confirms nothing about
 * what exists.
 */
@ApiTags('media')
@ActorKinds('user')
@Controller({ path: 'media', version: '2' })
export class ChatMediaController {
  constructor(
    private readonly store: ChatMediaStore,
    private readonly tokens: MediaTokenService,
    @Optional() @Inject(MEDIA_ACCESS_POLICY) private readonly policy?: ChatMediaAccessPolicy,
  ) {}

  @Get(':token')
  @ApiExcludeEndpoint()
  async read(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    const notFound = () => AppError.notFound('Media');

    const link = this.tokens.verify(token);
    if (!link || ctx.userId === null) throw notFound();
    if (link.orgId !== ctx.orgId || link.userId !== ctx.userId) throw notFound();
    if (!this.store.ownsKey(ctx.orgId, link.key)) throw notFound();
    if (
      this.policy &&
      !(await this.policy.canRead({ orgId: ctx.orgId, userId: ctx.userId }, link.key))
    ) {
      throw notFound();
    }

    let media;
    try {
      media = await this.store.open(ctx.orgId, link.key, parseRange(req.header('range')));
    } catch (err) {
      if (err instanceof MediaRangeError) {
        res.status(416).setHeader('Content-Range', `bytes */${err.size}`).end();
        return;
      }
      throw err;
    }
    if (!media) throw notFound();

    const mime = servableMime(link.mime, link.key);
    const inline = isInlineMime(mime);

    res.status(media.partial ? 206 : 200);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(media.end - media.start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    if (media.partial)
      res.setHeader('Content-Range', `bytes ${media.start}-${media.end}/${media.size}`);
    res.setHeader('Content-Disposition', contentDisposition(inline, link.name ?? 'file'));
    // A customer's file is served as data: the browser must not guess a type, run it, or let another origin embed it.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, max-age=300');

    pipeline(media.stream, res, () => undefined);
  }
}

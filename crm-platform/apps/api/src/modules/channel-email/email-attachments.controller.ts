import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  ChatMediaStore,
  MediaRangeError,
  servableMime,
} from '../../infra/providers/chat-conversations/media';
import { isInlineMime } from '../../infra/providers/chat-conversations/media/media-types';
import { EmailMessageAccess } from '../chat-conversations';
import { keyOfAttachmentId } from './mail-ingest.service';

/** `bytes=500-` and `bytes=500-999`; anything else is answered with the whole file (RFC 9110 allows it). */
function parseRange(header: string | undefined): { start: number; end?: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === '' ? undefined : Number(m[2]);
  return end !== undefined && end < start ? undefined : { start, end };
}

const contentDisposition = (inline: boolean, name: string) =>
  `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/**
 * A file of an inbound email, read through the conversation it arrived on (TW-MAIL-026): `GET /v2/email/attachments/:conversationId/
 * :messageId/:attachmentId`. The caller must be allowed to read the conversation (the inbox's own visibility rule, through
 * `EmailMessageAccess`), the message must be in that conversation, and the attachment must be listed in that message's own `meta.email`:
 * a key is never taken from the request. Every refusal is the same 404. Not behind the plan feature: what already arrived stays readable
 * after the add-on lapses.
 */
@ApiTags('email')
@ActorKinds('user')
@Controller({ path: 'email/attachments', version: '2' })
export class EmailAttachmentsController {
  constructor(
    private readonly access: EmailMessageAccess,
    private readonly store: ChatMediaStore,
  ) {}

  @Get(':conversationId/:messageId/:attachmentId')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'Download an attachment of an email message',
    description:
      'Streams the stored file with `nosniff`, a sandboxing CSP and a private cache header. Images referenced by the HTML body (`cid:<attachment id>`) are served inline, everything else as a download. 404 for anything the caller may not see.',
  })
  async read(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    const notFound = () => AppError.notFound('Attachment');

    const ref = await this.access.readable(conversationId, messageId);
    if (!ref) throw notFound();
    const attachment = ref.email.attachments.find((a) => a.id === attachmentId);
    if (!attachment || attachment.tooLarge) throw notFound();
    const key = keyOfAttachmentId(attachment.id);
    if (!this.store.ownsKey(ctx.orgId, key)) throw notFound();

    let media;
    try {
      media = await this.store.open(ctx.orgId, key, parseRange(req.header('range')));
    } catch (err) {
      if (err instanceof MediaRangeError) {
        res.status(416).setHeader('Content-Range', `bytes */${err.size}`).end();
        return;
      }
      throw err;
    }
    if (!media) throw notFound();

    const mime = servableMime(attachment.mime, key);
    const inline = attachment.inline && isInlineMime(mime);
    res.status(media.partial ? 206 : 200);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(media.end - media.start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    if (media.partial)
      res.setHeader('Content-Range', `bytes ${media.start}-${media.end}/${media.size}`);
    res.setHeader('Content-Disposition', contentDisposition(inline, attachment.name));
    // A stranger's file is served as data: the browser must not guess a type, run it, or let another origin embed it.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, max-age=300');
    pipeline(media.stream, res, () => undefined);
  }
}

import { Get, HttpCode, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream';
import { RequestContextStore } from '../../../../common/context/request-context';
import {
  ChatMediaStore,
  MediaTokenService,
  servableMime,
} from '../../../../infra/providers/chat-conversations/media';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { ok } from '../../http/v1-envelope';
import { MediaIntakeService, type UploadedFile as UploadedFileShape } from './media-intake.service';
import { notFound } from './messaging-errors';
import { v1FileUpload } from './v1-file-upload';

/** Media: upload a file once (WD-API-113) and read it back with the same key. */
@V1Controller('media')
@RequirePlanFeature('public_api')
export class V1MediaController {
  constructor(
    private readonly intake: MediaIntakeService,
    private readonly store: ChatMediaStore,
    private readonly tokens: MediaTokenService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireApiScope('media:write')
  @UseInterceptors(v1FileUpload('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file to reuse in a message',
    description:
      "Multipart field `file`, up to 16 MB, of an allowed type (images, video, audio, PDF and Office documents, text, CSV, ZIP). The answer's `url` is read with the same API key and can be passed as `media_url` when sending.",
  })
  async upload(@UploadedFile() file: UploadedFileShape | undefined) {
    return ok(await this.intake.upload(file));
  }

  /** The file behind a link this API gave out. The token names one file of one workspace and works for minutes (a day after an upload). */
  @Get(':token')
  @RequireApiScope('media:read')
  @ApiExcludeEndpoint()
  async read(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const ctx = RequestContextStore.require();
    const link = this.tokens.verify(token);
    if (!link || link.orgId !== ctx.orgId || !this.store.ownsKey(ctx.orgId, link.key))
      throw notFound('Media');
    const media = await this.store.open(ctx.orgId, link.key);
    if (!media) throw notFound('Media');

    const mime = servableMime(link.mime, link.key);
    const name = encodeURIComponent(link.name ?? 'file').replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.status(200);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(media.end - media.start + 1));
    // A customer's or an integrator's file is data, never a page: no sniffing, no scripts, and always offered as a download.
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${name}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    pipeline(media.stream, res, () => undefined);
  }
}

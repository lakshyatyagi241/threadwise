import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MARKETING_MEDIA_MAX_BYTES } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { MarketingMediaService } from './marketing-media.service';

/** `POST /v2/media/marketing`: one file for a broadcast, a campaign, a Telegram broadcast, a Facebook post or a LINE broadcast. */
@ApiTags('broadcasts')
@ActorKinds('user')
@Controller({ path: 'media', version: '2' })
export class MarketingMediaController {
  constructor(private readonly media: MarketingMediaService) {}

  @Post('marketing')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(
    'bcast.broadcasts.create',
    'camp.campaigns.create',
    'camp.campaigns.update',
    'tg.broadcasts.manage',
    'fb.posts.manage',
    'line.broadcasts.manage',
  )
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MARKETING_MEDIA_MAX_BYTES, files: 1 } }),
  )
  @ApiOperation({
    summary:
      'Upload a file for a message sent to many people; returns an address the provider can fetch',
    description:
      '422 for a type or content the upload policy refuses, and when media storage is local disk (nothing the provider could fetch).',
  })
  upload(@UploadedFile() file: { originalname: string; buffer: Buffer } | undefined) {
    return this.media.upload(file);
  }
}

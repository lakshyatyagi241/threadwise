import { Injectable } from '@nestjs/common';
import { MARKETING_MEDIA_MAX_BYTES, type MarketingMedia } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { UploadPolicyService } from '../auth';
import { MediaStorageService } from '../platform-settings-branding-storage';

/** A signed link on a private bucket lasts as long as a signature can: a scheduled campaign needs it days later. */
const LINK_TTL_S = 7 * 24 * 3600;

const kindOf = (mime: string): MarketingMedia['kind'] =>
  mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'document';

/**
 * The upload behind every "attach a file" box of a marketing message (WaDesk's `campaign-media` and broadcast uploads). The file is
 * checked by the shared upload policy (extension list plus content signature), stored on the workspace's object storage under its own
 * folder, and answered as an address the provider can fetch. Local-disk storage cannot make one (Meta fetches the file itself), so
 * that is refused with the reason instead of storing a file nobody can reach.
 */
@Injectable()
export class MarketingMediaService {
  constructor(
    private readonly storage: MediaStorageService,
    private readonly uploads: UploadPolicyService,
  ) {}

  async upload(
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<MarketingMedia> {
    const { orgId } = RequestContextStore.require();
    if (!file) {
      throw AppError.validation('Choose a file to upload', [
        { path: 'file', message: 'Required.' },
      ]);
    }
    const checked = this.uploads.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image', 'media', 'document'],
      maxBytes: MARKETING_MEDIA_MAX_BYTES,
    });
    const key = `marketing/${orgId}/${checked.storedName}`;
    const stored = await this.storage.put(key, file.buffer, checked.mime);
    if (!stored) {
      throw AppError.validation(
        'Files for messages need cloud object storage: ask the platform admin to turn it on, or paste a public address instead',
        [{ path: 'file', message: 'Storage is local.' }],
      );
    }
    return {
      url: await this.storage.url(key, LINK_TTL_S),
      name: file.originalname.slice(0, 255),
      mime: checked.mime,
      kind: kindOf(checked.mime),
      size: file.buffer.length,
    };
  }
}

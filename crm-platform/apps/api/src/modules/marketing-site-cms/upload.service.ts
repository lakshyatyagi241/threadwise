import { Injectable } from '@nestjs/common';
import {
  CMS_KEYS,
  CMS_UPLOAD_MAX_BYTES,
  cmsUploadKeySchema,
  type CmsUploadResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, UploadPolicyService } from '../auth';
import { MediaStorageService } from '../platform-settings-branding-storage';
import { CMS_EVENTS } from './cms-context';
import { CmsStore } from './cms-store';
import { CmsContentService } from './content.service';

/**
 * The page editor's image upload (TW-CMS-027). Reference saved the file to its public web folder; here it goes to the platform's object
 * storage (the SET media door) under `site/`, and the answer is the address a visitor's browser can load. The shared upload policy
 * checks extension and content signature (SVG is refused: it can carry script, and Reference's `image` rule refused it too). With a
 * `key` the address is also saved as that field's draft, which only a link field can hold. Local-disk storage and a private bucket
 * with no CDN cannot make a lasting public address, so they are refused with the reason.
 */
@Injectable()
export class CmsUploadService {
  constructor(
    private readonly storage: MediaStorageService,
    private readonly uploads: UploadPolicyService,
    private readonly content: CmsContentService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
  ) {}

  async upload(
    file: { originalname: string; buffer: Buffer } | undefined,
    key: string | undefined,
  ): Promise<CmsUploadResponse> {
    if (!file) {
      throw AppError.validation('Choose an image to upload', [
        { path: 'file', message: 'Required.' },
      ]);
    }
    if (key !== undefined && key !== '') {
      if (!cmsUploadKeySchema.safeParse(key).success) {
        throw AppError.validation('The field name is not valid', [
          { path: 'key', message: 'Invalid.' },
        ]);
      }
      const info = CMS_KEYS.get(key);
      if (!info || info.type !== 'link') {
        throw AppError.validation('This field cannot hold an image address', [
          { path: 'key', message: 'Not an address field.' },
        ]);
      }
    }
    const checked = await this.uploads.validateScanned({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image'],
      maxBytes: CMS_UPLOAD_MAX_BYTES,
    });
    const d = await this.storage.destination();
    if (d.disk !== 'cloud' || (d.visibility === 'private' && !d.cdnUrl)) {
      throw AppError.validation(
        'Site images need public cloud object storage: turn it on in the platform storage settings, or paste an image address instead',
        [{ path: 'file', message: 'Storage is not public.' }],
      );
    }
    const objectKey = `site/${checked.storedName}`;
    const stored = await this.storage.put(objectKey, file.buffer, checked.mime);
    if (!stored) {
      throw AppError.validation('The image could not be stored', [
        { path: 'file', message: 'Storage is local.' },
      ]);
    }
    const url = await this.storage.url(objectKey);
    if (key) {
      await this.content.saveDraft({ entries: [{ key, value: url }] });
      await this.store.tx((tx) =>
        this.audit.record(tx, {
          event: CMS_EVENTS.imageUploaded,
          status: 'success',
          payload: { key },
        }),
      );
    }
    return { ok: true, url };
  }
}

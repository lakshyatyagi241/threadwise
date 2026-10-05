import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MediaStorageService } from '../../platform-settings-branding-storage';
import type { MediaStore } from './tokens';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Seven days: the longest a signed link on a private bucket can live. */
const LINK_TTL_S = 7 * 24 * 3600;

/**
 * Telegram's own files (a contact's profile photo) on the workspace's object storage. Local-disk storage has no address Telegram or a
 * browser outside this server could use, so it saves nothing and the contact keeps no photo. A broadcast file is a public address
 * (or one uploaded through the marketing-media route), so `read` has nothing of ours to hand back.
 */
@Injectable()
export class StorageMediaStore implements MediaStore {
  readonly enabled = true;

  constructor(private readonly storage: MediaStorageService) {}

  async save(orgId: number, bytes: Uint8Array, extension: string): Promise<string | null> {
    const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mime = MIME[ext];
    if (!mime) return null;
    const key = `telegram/${orgId}/${Date.now()}_${randomBytes(8).toString('hex')}.${ext}`;
    const stored = await this.storage.put(key, Buffer.from(bytes), mime);
    return stored ? this.storage.url(key, LINK_TTL_S) : null;
  }

  read(): Promise<null> {
    return Promise.resolve(null);
  }

  publicUrl(path: string): string | null {
    return /^https?:\/\//i.test(path) ? path : null;
  }
}

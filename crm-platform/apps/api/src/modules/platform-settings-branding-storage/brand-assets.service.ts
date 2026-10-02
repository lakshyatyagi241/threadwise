import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { PlatformSettingsService } from '../auth';
import { SettingsService } from './settings.service';

/**
 * Brand files (TW-SET-010, 035, 038): the favicon, one logo per theme, and the two icon sizes of each installable app.
 *
 * Reference kept these on the local disk on purpose (platform identity must not depend on a bucket) and never deleted the
 * old file. There is no file module yet, so the bytes live in the platform settings store (one row per slot, replaced on
 * upload, so nothing is orphaned) and are served by `GET /v2/public/brand/:slot`. The saved URL carries a short content
 * hash, which makes the response cacheable for good and a replaced file visible at once.
 */

export interface AssetSlot {
  group: 'branding' | 'pwa' | 'tiPwa';
  /** Field path inside the group document. */
  path: string[];
  maxKb: number;
  mimes: readonly string[];
}

const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
const APP_ICON = ['image/png', 'image/webp'] as const;

export const ASSET_SLOTS: Record<string, AssetSlot> = {
  favicon: { group: 'branding', path: ['faviconUrl'], maxKb: 512, mimes: [...IMG, 'image/x-icon'] },
  'logo-paper': { group: 'branding', path: ['logos', 'paper'], maxKb: 1024, mimes: IMG },
  'logo-bright': { group: 'branding', path: ['logos', 'bright'], maxKb: 1024, mimes: IMG },
  'logo-dark': { group: 'branding', path: ['logos', 'dark'], maxKb: 1024, mimes: IMG },
  'logo-doodle': { group: 'branding', path: ['logos', 'doodle'], maxKb: 1024, mimes: IMG },
  'pwa-192': { group: 'pwa', path: ['icon192'], maxKb: 1024, mimes: APP_ICON },
  'pwa-512': { group: 'pwa', path: ['icon512'], maxKb: 2048, mimes: APP_ICON },
  'ti-192': { group: 'tiPwa', path: ['icon192'], maxKb: 1024, mimes: APP_ICON },
  'ti-512': { group: 'tiPwa', path: ['icon512'], maxKb: 2048, mimes: APP_ICON },
};

const assetKey = (slot: string) => `set.asset.${slot}`;

/** The file's real type from its first bytes; the client's claimed type and file name are never trusted. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from('00000100', 'hex')))
    return 'image/x-icon';
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(head))
    return 'image/svg+xml';
  return null;
}

interface StoredAsset {
  mime: string;
  data: string;
  hash: string;
  size: number;
}

@Injectable()
export class BrandAssetsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly store: PlatformSettingsService,
  ) {}

  private slot(name: string): AssetSlot {
    const s = ASSET_SLOTS[name];
    if (!s) {
      throw AppError.validation('Unknown brand asset', [
        { path: 'slot', message: `must be one of ${Object.keys(ASSET_SLOTS).join(', ')}` },
      ]);
    }
    return s;
  }

  private withPath(
    values: Record<string, unknown>,
    path: string[],
    value: string,
  ): Record<string, unknown> {
    if (path.length === 1) return { ...values, [path[0]!]: value };
    const [head, ...rest] = path;
    return {
      ...values,
      [head!]: this.withPath((values[head!] ?? {}) as Record<string, unknown>, rest, value),
    };
  }

  /** Validates the file, replaces the slot's row and points the group's field at it, in one transaction. */
  async upload(
    name: string,
    file: Buffer | undefined,
    operatorId: number,
  ): Promise<{ url: string }> {
    const slot = this.slot(name);
    if (!file || file.length === 0) {
      throw AppError.validation('Choose a file to upload', [
        { path: 'file', message: 'a file is required' },
      ]);
    }
    if (file.length > slot.maxKb * 1024) {
      throw AppError.validation('The file is too large', [
        { path: 'file', message: `must be at most ${slot.maxKb} KB` },
      ]);
    }
    const mime = sniffImage(file);
    if (!mime || !slot.mimes.includes(mime)) {
      throw AppError.validation('This file type is not allowed here', [
        { path: 'file', message: `must be one of ${slot.mimes.join(', ')}` },
      ]);
    }
    const hash = createHash('sha256').update(file).digest('hex').slice(0, 8);
    const url = `/api/v2/public/brand/${name}?v=${hash}`;
    const row: StoredAsset = { mime, data: file.toString('base64'), hash, size: file.length };
    await this.settings.mutate(
      slot.group,
      operatorId,
      (v) => this.withPath(v, slot.path, url),
      async (tx) => {
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${assetKey(name)}, ${JSON.stringify(row)}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      },
    );
    return { url };
  }

  /** Clears the slot (Reference had no way back to "no logo"; the port notes ask for one). */
  async remove(name: string, operatorId: number): Promise<void> {
    const slot = this.slot(name);
    await this.settings.mutate(
      slot.group,
      operatorId,
      (v) => this.withPath(v, slot.path, ''),
      async (tx) => {
        await tx.execute(sql`DELETE FROM platform_settings WHERE key = ${assetKey(name)}`);
      },
    );
  }

  /** The stored file, or null when the slot is empty. */
  async read(name: string): Promise<{ mime: string; bytes: Buffer; hash: string } | null> {
    if (!ASSET_SLOTS[name]) return null;
    // Read the one row directly: the store's snapshot holds every row and these are large.
    const row = await this.store.inTx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${assetKey(name)}`,
      );
      return (res.rows[0] as { value: StoredAsset } | undefined)?.value;
    });
    return row ? { mime: row.mime, bytes: Buffer.from(row.data, 'base64'), hash: row.hash } : null;
  }
}

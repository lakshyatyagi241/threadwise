import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  presignS3Get,
  resolveStorageTarget,
  signS3Request,
  type StorageTarget,
} from '../../infra/providers/platform-settings-branding-storage/object-storage.probe';
import { SettingsService } from './settings.service';

/**
 * Where client media goes (TW-SET-040): the saved cloud bucket when it is enabled AND complete, otherwise the local
 * disk. A half-configured provider therefore never fails an upload, it just stays local, exactly as in Reference.
 *
 * Every domain that stores media asks this one door for the destination, the object key and the URL, and stores bare
 * object keys (never a full URL), so a later provider change does not rewrite data. Differences from Reference, on purpose:
 * the base folder is applied to real uploads (it only ever reached the connection test), and a private bucket gets a real
 * time-limited link instead of a plain URL the bucket would refuse.
 */
export interface MediaDestination {
  disk: 'cloud' | 'local';
  target: StorageTarget | null;
  visibility: 'public' | 'private';
  cdnUrl: string;
}

const LOCAL_URL_ROOT = '/storage';

/** `storage/foo` and `/foo` both mean the object key `foo` (Reference's media_url strips a stray `storage/`). */
export function normaliseKey(path: string): string {
  return path
    .trim()
    .replace(/^\/+/, '')
    .replace(/^storage\//, '');
}

@Injectable()
export class MediaStorageService {
  /** Buckets this process has already made sure exist (the first write to a fresh MinIO creates it). */
  private readonly ensured = new Set<string>();

  constructor(
    private readonly settings: SettingsService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  /**
   * The deployment's own bucket (`S3_*`, MinIO in the compose stack), used when the saved settings give none and
   * `MEDIA_STORAGE_DRIVER=s3`. Without it every container keeps media on its own disk, so the worker that sends a file
   * cannot find what the API stored.
   */
  private envTarget(): StorageTarget | null {
    const c = this.config;
    if (!c || c.get('MEDIA_STORAGE_DRIVER', { infer: true }) !== 's3') return null;
    const endpoint = c.get('S3_ENDPOINT', { infer: true });
    const accessKeyId = c.get('S3_ACCESS_KEY_ID', { infer: true });
    const secret = c.get('S3_SECRET_ACCESS_KEY', { infer: true });
    if (!endpoint || !accessKeyId || !secret) return null;
    return {
      endpoint: endpoint.replace(/\/+$/, ''),
      region: c.get('S3_REGION', { infer: true }),
      bucket: c.get('S3_BUCKET_MEDIA', { infer: true }),
      accessKeyId,
      secret,
      pathStyle: c.get('S3_FORCE_PATH_STYLE', { infer: true }),
      prefix: '',
    };
  }

  async destination(): Promise<MediaDestination> {
    const v = await this.settings.values('storage');
    const target = v.enabled
      ? resolveStorageTarget({
          provider: v.provider,
          basePath: v.basePath,
          accessKeyId: v.accessKeyId,
          region: v.region,
          bucket: v.bucket,
          endpoint: v.endpoint,
          pathStyle: v.pathStyle,
          storageZone: v.storageZone,
          secret: await this.settings.secret('storage', 'secret'),
          storagePassword: await this.settings.secret('storage', 'storagePassword'),
        })
      : null;
    if (!target) {
      const fallback = this.envTarget();
      if (fallback) return { disk: 'cloud', target: fallback, visibility: 'private', cdnUrl: '' };
    }
    return {
      disk: target ? 'cloud' : 'local',
      target,
      visibility: v.visibility,
      cdnUrl: v.cdnUrl,
    };
  }

  private fullKey(d: MediaDestination, key: string): string {
    const k = normaliseKey(key);
    const prefix = d.target?.prefix ?? '';
    return prefix && !k.startsWith(`${prefix}/`) ? `${prefix}/${k}` : k;
  }

  /** The object key as stored on the bucket (base folder applied once). */
  async objectKey(key: string): Promise<string> {
    return this.fullKey(await this.destination(), key);
  }

  /**
   * Writes an object to the bucket. Returns null when media is local, so the caller writes it to its own disk; a bucket
   * that refuses the write throws (the caller decides whether to fall back).
   */
  async put(key: string, body: Buffer, contentType: string): Promise<{ key: string } | null> {
    const d = await this.destination();
    if (d.disk !== 'cloud' || !d.target) return null;
    const objectKey = this.fullKey(d, key);
    const send = () => {
      const req = signS3Request(d.target!, 'PUT', objectKey, body);
      return fetch(req.url, {
        method: 'PUT',
        headers: { ...req.headers, 'content-type': contentType },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    };
    let res = await send();
    if (res.status === 404 && (await this.ensureBucket(d.target))) res = await send();
    if (!res.ok) throw new Error(`Object storage refused the upload (HTTP ${res.status})`);
    return { key: objectKey };
  }

  /** Creates the bucket when the store says it is missing (a fresh MinIO has none). True when it now exists. */
  private async ensureBucket(t: StorageTarget): Promise<boolean> {
    if (this.ensured.has(t.bucket)) return false;
    const req = signS3Request(t, 'PUT', '', Buffer.alloc(0));
    const res = await fetch(req.url, {
      method: 'PUT',
      headers: req.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 409) return false;
    this.ensured.add(t.bucket);
    return true;
  }

  async remove(key: string): Promise<void> {
    const d = await this.destination();
    if (d.disk !== 'cloud' || !d.target) return;
    const req = signS3Request(d.target, 'DELETE', this.fullKey(d, key), Buffer.alloc(0));
    const res = await fetch(req.url, {
      method: 'DELETE',
      headers: req.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Object storage refused the delete (HTTP ${res.status})`);
    }
  }

  /**
   * The URL a browser should use: '' for an empty key; `/storage/<key>` for local media; for the bucket the CDN URL when
   * one is set (public buckets), else a path on the endpoint, and a signed link for a private bucket with no CDN.
   */
  async url(key: string, ttlSeconds = 3600): Promise<string> {
    if (key.trim() === '') return '';
    const d = await this.destination();
    const k = normaliseKey(key);
    if (d.disk !== 'cloud' || !d.target) return `${LOCAL_URL_ROOT}/${k}`;
    const objectKey = this.fullKey(d, k);
    if (d.cdnUrl) return `${d.cdnUrl.replace(/\/+$/, '')}/${objectKey}`;
    if (d.visibility === 'private') return presignS3Get(d.target, objectKey, ttlSeconds);
    const t = d.target;
    const base = new URL(t.endpoint);
    return t.pathStyle
      ? `${t.endpoint}/${t.bucket}/${objectKey}`
      : `${base.protocol}//${t.bucket}.${base.host}/${objectKey}`;
  }
}

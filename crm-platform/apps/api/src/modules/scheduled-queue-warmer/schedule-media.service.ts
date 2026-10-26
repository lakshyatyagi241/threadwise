import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  SCHEDULE_MEDIA_MAX_BYTES,
  type ScheduleMedia,
  type ScheduleMediaKind,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { UploadPolicyService } from '../auth';
import { MediaStorageService } from '../platform-settings-branding-storage';

/** The link given back to look at the file; the sender is given a fresh one at every run (see the message builder). */
const PREVIEW_TTL_S = 3600;

const kindOf = (mime: string): ScheduleMediaKind =>
  mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'document';

/**
 * The file of a scheduled message (TW-SCHED-006). The upload goes through the shared upload policy (extension list and content
 * signature), lands on the workspace's object storage under its own folder, and is recorded in `scheduled_media` (who, what, how
 * big), so a schedule can only point at a file its own workspace uploaded and the channel's size and type limits can be checked
 * against the real size. Local-disk storage cannot make an address a provider can fetch, so it is refused with the reason instead of
 * storing a file nobody can reach. A file nobody uses any more is removed from storage with the last schedule that used it.
 */
@Injectable()
export class ScheduleMediaService {
  private readonly logger = new Logger(ScheduleMediaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: MediaStorageService,
    private readonly uploads: UploadPolicyService,
  ) {}

  async upload(file: { originalname: string; buffer: Buffer } | undefined): Promise<ScheduleMedia> {
    const { orgId, userId } = RequestContextStore.require();
    if (!file) {
      throw AppError.validation('Choose a file to upload', [
        { path: 'file', message: 'Required.' },
      ]);
    }
    const checked = await this.uploads.validateScanned({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image', 'media', 'document'],
      maxBytes: SCHEDULE_MEDIA_MAX_BYTES,
    });
    const key = `scheduled/${orgId}/${checked.storedName}`;
    const stored = await this.storage.put(key, file.buffer, checked.mime);
    if (!stored) {
      throw AppError.validation(
        'Files for scheduled messages need cloud object storage: ask the platform admin to turn it on, or paste a public link instead',
        [{ path: 'file', message: 'Storage is local.' }],
      );
    }
    const name = file.originalname.slice(0, 255);
    const kind = kindOf(checked.mime);
    const row = await this.db.tx((tx) =>
      tx.execute(sql`
        INSERT INTO scheduled_media (org_id, user_id, storage_key, file_name, mime, kind, size_bytes)
        VALUES (${orgId}, ${userId ?? null}, ${key}, ${name}, ${checked.mime}, ${kind}, ${file.buffer.length})
        RETURNING uuid`),
    );
    return {
      id: (row.rows[0] as { uuid: string }).uuid,
      name,
      mime: checked.mime,
      kind,
      size: file.buffer.length,
      url: await this.storage.url(key, PREVIEW_TTL_S),
    };
  }

  /** A look-at link for a stored file (the edit screen shows what was uploaded). */
  async link(key: string): Promise<string> {
    return this.storage.url(key, PREVIEW_TTL_S);
  }

  /**
   * Drops the file's record and object once no schedule of the workspace points at it. Called after the schedule that used it was
   * deleted or changed; a storage failure is logged and never undoes the change (the record stays, so a later call can try again).
   */
  async releaseIfUnused(orgId: number, key: string | null): Promise<void> {
    if (!key || /^https?:\/\//i.test(key)) return;
    const gone = await this.db.tx(async (tx) => {
      const used = await tx.execute(sql`
        SELECT 1 FROM scheduled_messages WHERE org_id = ${orgId} AND media_file = ${key} LIMIT 1`);
      if (used.rows.length > 0) return false;
      const del = await tx.execute(sql`
        DELETE FROM scheduled_media WHERE org_id = ${orgId} AND storage_key = ${key} RETURNING id`);
      return del.rows.length > 0;
    });
    if (!gone) return;
    try {
      await this.storage.remove(key);
    } catch (err) {
      this.logger.warn(
        { orgId, err: String(err) },
        '[SCHED] a file of a deleted schedule was not removed from storage',
      );
    }
  }

  /** The upload a stored key belongs to, for the detail and the edit screen. */
  async describe(
    tx: Tx,
    orgId: number,
    key: string | null,
  ): Promise<{
    id: string;
    name: string;
    mime: string;
    kind: ScheduleMediaKind;
    size: number;
  } | null> {
    if (!key || /^https?:\/\//i.test(key)) return null;
    const res = await tx.execute(sql`
      SELECT uuid, file_name, mime, kind, size_bytes FROM scheduled_media
       WHERE org_id = ${orgId} AND storage_key = ${key}`);
    const r = res.rows[0] as
      | {
          uuid: string;
          file_name: string;
          mime: string;
          kind: ScheduleMediaKind;
          size_bytes: number;
        }
      | undefined;
    return r
      ? { id: r.uuid, name: r.file_name, mime: r.mime, kind: r.kind, size: Number(r.size_bytes) }
      : null;
  }
}

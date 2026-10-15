import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { storageKeyIsOwnedBy } from '../../../common/storage-key-owner';
import { DatabaseService } from '../../../infra/db/database.service';
import { ChatMediaStore } from '../../../infra/providers/chat-conversations/media';
import { MediaStorageService } from '../../platform-settings-branding-storage';

const BATCH = 100;
const MAX_ATTEMPTS = 8;

/** What deletes one stored file. Two doors exist (the chat store also owns local disk), so both are tried. */
export interface FileRemover {
  remove(orgId: number, key: string): Promise<void>;
}

/**
 * Deletes the files of erased workspaces from storage (ADR-0028). The erase transaction queues every file key it finds in
 * `storage_purge_queue` and removes the rows that pointed at the files; this worker is what actually removes the bytes, so an
 * erasure is not complete until the queue is empty. A failure is counted and retried with the row left in place; after
 * MAX_ATTEMPTS the row stays with its last error for an operator to see, and is never silently dropped.
 *
 * Both doors are asked for every key: the chat media store (local disk and bucket, for keys it owns) and the platform media
 * storage (the bucket, any key). Removing a key that is already gone is not an error.
 */
@Injectable()
export class StoragePurgeService {
  private readonly logger = new Logger(StoragePurgeService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaStorageService,
    @Optional() private readonly chat?: ChatMediaStore,
  ) {}

  @Cron('*/10 * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const n = await this.pass();
        total += n;
        if (n < BATCH) break;
      }
      if (total > 0) this.logger.log({ purged: total }, 'storage purge');
    } catch (err) {
      this.logger.error({ err }, 'storage purge failed');
    } finally {
      this.running = false;
    }
  }

  /** One batch; returns how many rows it handled (purged or failed). */
  async pass(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, org_id, storage_key FROM storage_purge_queue
         WHERE purged_at IS NULL AND attempts < ${MAX_ATTEMPTS}
         ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`);
      const rows = res.rows as unknown as Array<{
        id: number;
        org_id: number;
        storage_key: string;
      }>;
      for (const r of rows) {
        try {
          // TI-022: the key was written by the tenant; never delete an object that is not under this workspace's own prefix.
          if (!storageKeyIsOwnedBy(Number(r.org_id), r.storage_key)) {
            // Not a transient failure: park it at the attempt limit so it is never retried, with the reason for an operator.
            await tx.execute(sql`
              UPDATE storage_purge_queue SET attempts = ${MAX_ATTEMPTS}, last_error = 'key is not under this workspace; not deleted'
               WHERE id = ${r.id}`);
            continue;
          }
          await this.chat?.remove(Number(r.org_id), r.storage_key);
          await this.media.remove(r.storage_key);
          await tx.execute(
            sql`UPDATE storage_purge_queue SET purged_at = now(), last_error = NULL WHERE id = ${r.id}`,
          );
        } catch (err) {
          await tx.execute(sql`
            UPDATE storage_purge_queue SET attempts = attempts + 1, last_error = ${String((err as Error).message).slice(0, 300)}
             WHERE id = ${r.id}`);
        }
      }
      return rows.length;
    });
  }
}

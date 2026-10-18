import { Injectable, Logger, Optional } from '@nestjs/common';
import { isCountedStorageCategory, type StorageCategory } from '@crm/contracts';
import { canonicalStorageKey, storageKeyIsOwnedBy } from '../../common/storage-key-owner';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { StorageModeService } from './storage-mode.service';
import { BACKFILL_PAGE, OWNER_SOURCES, type OwnerSource } from './storage-owners';
import { StorageQuotaRepository, type OwnerRow } from './storage-quota.repository';
import { isStorageCategory } from './storage-quota.rules';
import { StorageReconcileService } from './storage-reconcile.service';

/** Pause between two pages of one workspace, so a backfill never competes with live traffic for the database or the bucket. */
const PAGE_PAUSE_MS = 150;
/** Size probes (one HEAD each on a bucket) in flight at once. */
const PROBE_CONCURRENCY = 4;

export interface BackfillResult {
  orgId: number;
  skipped: boolean;
  /** Objects newly registered, per owner source. */
  adopted: Record<string, number>;
  /** Keys the owner table names but the store does not have: left out. */
  missing: number;
  /**
   * Objects whose size could not be asked for (the bucket errored, or no media store is bound in this process). The workspace is NOT marked
   * done while any are left, so the pick-up queues it again; registering them at zero or not at all would leave the meter short for good.
   */
  deferred: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Builds a workspace's registry from the rows that own files (spec section 15, step 3): idempotent (upsert on `(org, key)`, so objects a
 * door already registered are left alone), batched and throttled, resumable (restarting just walks the pages again), and safe while
 * writes continue (a concurrent door commit and an adopt of the same key converge on one row).
 *
 * It measures what it can trust: a size the server wrote (`messages.media_size`, `scheduled_media.size_bytes`, ...) or, for the kinds
 * that keep none (recordings, contact files, knowledge files), the object itself (a stat on local disk, one HEAD on the bucket). It
 * never uses a client's claim, and it never writes to or deletes from the object store.
 *
 * Not covered, by design (recorded in the wiring map): campaign and broadcast media (the owner row keeps a URL, not a key), email
 * attachments received before the meter existed (the key lives inside `messages.meta`), and objects no row names. The weekly bucket
 * verify of phase S5 adopts those.
 */
@Injectable()
export class StorageBackfillService {
  private readonly logger = new Logger(StorageBackfillService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StorageQuotaRepository,
    private readonly mode: StorageModeService,
    private readonly reconcile: StorageReconcileService,
    @Optional() private readonly media?: ChatMediaStore,
  ) {}

  async backfillOrg(orgId: number): Promise<BackfillResult> {
    const result: BackfillResult = { orgId, skipped: false, adopted: {}, missing: 0, deferred: 0 };
    if ((await this.mode.current()) === 'off') return { ...result, skipped: true };

    for (const source of OWNER_SOURCES) {
      result.adopted[source.id] = await this.backfillSource(orgId, source, result);
    }

    // Counters, team chat blobs and links from the registry as it now stands; then the workspace is marked done.
    await this.reconcile.reconcileOrg(orgId);
    if (result.deferred === 0) {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.markBackfilled(tx, orgId, new Date()),
      );
    }
    this.logger.log({ ...result }, '[STORAGE] backfill finished');
    return result;
  }

  private async backfillSource(
    orgId: number,
    source: OwnerSource,
    result: BackfillResult,
  ): Promise<number> {
    let adopted = 0;
    let afterId = 0;
    for (;;) {
      const page = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.ownerPage(tx, orgId, source, afterId, BACKFILL_PAGE),
      );
      if (page.length === 0) break;
      afterId = page[page.length - 1]!.id;

      // Reads and probes happen outside any write transaction: a HEAD on a slow bucket must not hold a connection open.
      const resolved = await this.resolveSizes(orgId, source, page, result);
      if (resolved.length > 0) {
        adopted += await this.db.txAs({ orgId, userId: null }, async (tx) => {
          let n = 0;
          for (const r of resolved) {
            const inserted = await this.repo.adopt(tx, {
              orgId,
              key: r.key,
              category: r.category,
              bytes: r.bytes,
              ownerTable: source.table,
              ownerId: r.id,
            });
            if (inserted) n += 1;
          }
          return n;
        });
      }
      if (page.length < BACKFILL_PAGE) break;
      await sleep(PAGE_PAUSE_MS);
    }
    return adopted;
  }

  private async resolveSizes(
    orgId: number,
    source: OwnerSource,
    page: OwnerRow[],
    result: BackfillResult,
  ): Promise<Array<{ id: number; key: string; bytes: number; category: StorageCategory }>> {
    const out: Array<{ id: number; key: string; bytes: number; category: StorageCategory }> = [];
    const toProbe: Array<{ row: OwnerRow; key: string; category: StorageCategory }> = [];

    for (const row of page) {
      const category = this.categoryOf(source, row);
      if (!isCountedStorageCategory(category)) continue;
      // A key that is not this workspace's (an external URL stored in the same column, a foreign key) is not an object of ours.
      if (!storageKeyIsOwnedBy(orgId, row.key)) continue;
      // The registry holds the key in the form the doors write and remove it in (`storage/chat/7/x` and `/chat/7/x` are `chat/7/x`).
      const key = canonicalStorageKey(row.key);
      if (row.size !== null && row.size > 0)
        out.push({ id: row.id, key, bytes: row.size, category });
      else toProbe.push({ row, key, category });
    }

    for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
      const batch = toProbe.slice(i, i + PROBE_CONCURRENCY);
      const sizes = await Promise.all(batch.map((p) => this.probe(orgId, p.key)));
      batch.forEach((p, j) => {
        const size = sizes[j]!;
        if (size === 'unknown') {
          result.deferred += 1;
        } else if (size === null || size <= 0) {
          result.missing += 1;
        } else {
          out.push({ id: p.row.id, key: p.key, bytes: size, category: p.category });
        }
      });
    }
    return out;
  }

  /** The size of an object; null when it is not there; `'unknown'` when the store could not be asked (an error, or no media store in this process). */
  private async probe(orgId: number, key: string): Promise<number | null | 'unknown'> {
    if (!this.media) return 'unknown';
    try {
      return await this.media.sizeOf(orgId, key);
    } catch (err) {
      this.logger.warn(
        { orgId, err: String(err) },
        '[STORAGE] a size check failed; the workspace is queued again',
      );
      return 'unknown';
    }
  }

  private categoryOf(source: OwnerSource, row: OwnerRow): StorageCategory {
    const c = source.category;
    if (typeof c === 'string') return c;
    const picked = row.cat !== null ? c.values[row.cat] : undefined;
    const category = picked ?? c.fallback;
    return isStorageCategory(category) ? category : c.fallback;
  }
}

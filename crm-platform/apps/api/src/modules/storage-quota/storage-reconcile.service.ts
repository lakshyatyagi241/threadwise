import { Injectable, Logger } from '@nestjs/common';
import type { StorageLevel } from '@crm/contracts';
import { teamChatBlobKey } from '../../common/storage-meter/storage-key-category';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { StorageModeService } from './storage-mode.service';
import { OWNER_SOURCES } from './storage-owners';
import { StorageQuotaRepository } from './storage-quota.repository';
import { TEAM_CHAT_BLOB_TABLE, capBytesFromGb, levelFor } from './storage-quota.rules';

export interface ReconcileResult {
  orgId: number;
  skipped: boolean;
  hotBytes: number;
  capBytes: number;
  level: StorageLevel;
  /** Hot bytes the stored counter was off by before this run corrected it. */
  driftBytes: number;
  /** Pending registry rows that found their owner row. */
  linked: number;
  /** Team chat blobs added to / dropped from the registry (the blob table is the source of truth for that kind). */
  blobsAdded: number;
  blobsRemoved: number;
}

/**
 * The nightly counter check for one workspace (spec 4.4, "Counter check" and the DB-only half of "Orphan check"), plus the display fields
 * the operator's fleet view needs. It never touches the object store and never deletes a file.
 *
 * LEGAL-HOLD INTEGRATION POINT (storage quota S5, spec 9.2): this class, and `StorageQuotaRepository.remove`, delete only REGISTRY rows (never an object),
 * so they do not consult the legal hold guard. The first code that deletes an OBJECT for a storage reason (the orphan sweep, the cold expiry, the owner
 * "delete older than") must call `LegalHoldGuard` / `is_subject_held` before it deletes and count `skippedHeld`; add that file to
 * `legal-hold-coverage.spec.ts`. The guard is on branch `lakshya/next/legal-hold` and is not on `main` yet: do not duplicate it here.
 *
 *   1. Team chat attachments (Postgres blobs) are synced with their table: they cascade away with their message without telling the
 *      meter, so the table, not the registry, is the truth for that kind.
 *   2. `pending` registry rows are linked to the row that owns their key (the owner map).
 *   3. The counters are recomputed from the registry and the drift is recorded.
 *   4. The cap is read from the plan (`storage_gb`) and the level is computed. Display only: observe mode refuses nothing at any level.
 */
@Injectable()
export class StorageReconcileService {
  private readonly logger = new Logger(StorageReconcileService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StorageQuotaRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly mode: StorageModeService,
  ) {}

  async reconcileOrg(orgId: number, now: Date = new Date()): Promise<ReconcileResult> {
    const empty: ReconcileResult = {
      orgId,
      skipped: true,
      hotBytes: 0,
      capBytes: 0,
      level: 'ok',
      driftBytes: 0,
      linked: 0,
      blobsAdded: 0,
      blobsRemoved: 0,
    };
    if ((await this.mode.current()) === 'off') return empty;

    // Outside the transaction: the plan lookup opens its own.
    const capBytes = capBytesFromGb(await this.entitlements.limit(orgId, 'storage_gb'));

    const out = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const prefix = `pg:${TEAM_CHAT_BLOB_TABLE}:`;
      const [blobs, registered] = await Promise.all([
        this.repo.teamChatBlobs(tx, orgId),
        this.repo.registeredBlobKeys(tx, orgId, prefix),
      ]);
      let blobsAdded = 0;
      const present = new Set<string>();
      for (const blob of blobs) {
        const key = teamChatBlobKey(blob.messageId);
        present.add(key);
        if (registered.has(key)) continue;
        await this.repo.adopt(tx, {
          orgId,
          key,
          category: 'team_chat_attachment',
          bytes: blob.bytes,
          ownerTable: 'team_chat_messages',
          ownerId: blob.messageId,
        });
        blobsAdded += 1;
      }
      let blobsRemoved = 0;
      for (const key of registered.keys()) {
        if (present.has(key)) continue;
        await this.repo.remove(tx, orgId, key);
        blobsRemoved += 1;
      }

      let linked = 0;
      for (const source of OWNER_SOURCES) {
        linked += await this.repo.linkPending(tx, orgId, source);
      }

      const rebuilt = await this.repo.rebuildCounters(
        tx,
        orgId,
        capBytes,
        (hot) => levelFor(hot, capBytes),
        now,
      );
      return { rebuilt, linked, blobsAdded, blobsRemoved };
    });

    if (out.rebuilt.driftBytes > 0) {
      this.logger.warn(
        { orgId, driftBytes: out.rebuilt.driftBytes },
        '[STORAGE] the nightly counter check corrected a drift',
      );
    }
    return {
      orgId,
      skipped: false,
      hotBytes: out.rebuilt.hotBytes,
      capBytes,
      level: out.rebuilt.level as StorageLevel,
      driftBytes: out.rebuilt.driftBytes,
      linked: out.linked,
      blobsAdded: out.blobsAdded,
      blobsRemoved: out.blobsRemoved,
    };
  }
}

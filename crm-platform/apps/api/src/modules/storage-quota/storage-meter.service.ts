import { Injectable } from '@nestjs/common';
import { isCountedStorageCategory, type StorageCategory } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  NO_RESERVATION,
  meterFailedOpen,
  type StorageCommit,
  type StorageMeter,
  type StorageReservation,
  type StorageReserveRequest,
} from '../../common/storage-meter/storage-meter.port';
import { DatabaseService } from '../../infra/db/database.service';
import { StorageModeService } from './storage-mode.service';
import { StorageQuotaRepository } from './storage-quota.repository';
import { RESERVATION_TTL_MS } from './storage-quota.rules';

/**
 * The storage meter in OBSERVE mode (spec docs/specs/storage-quota-and-archival.md section 4.2, phases S0 and S1): reserve, write,
 * commit, with every step fail-open.
 *
 * What it does: `reserve` records the promised bytes (a reservation row, `reserved_bytes`); `commit` settles them into the registry
 * (`storage_objects`) and the counters (`storage_usage`, `storage_org_state.hot_bytes`); `recordRemoved` gives a deleted object's bytes back.
 *
 * What it never does: refuse a write, throw into one, or wait for a plan lookup. There is no cap check here at all; the decision to
 * refuse is phase S2's conditional UPDATE and reads the entitlement service per call. A database fault, an unknown workspace or a bug
 * in this file makes the step a logged, counted no-op (`crm_storage_meter_failures_total`) and the file write goes on.
 */
@Injectable()
export class StorageMeterService implements StorageMeter {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StorageQuotaRepository,
    private readonly mode: StorageModeService,
  ) {}

  async reserve(request: StorageReserveRequest): Promise<StorageReservation> {
    try {
      if (!isCountedStorageCategory(request.category)) return NO_RESERVATION;
      if (!Number.isFinite(request.bytes) || request.bytes <= 0) return NO_RESERVATION;
      if ((await this.mode.current()) === 'off') return NO_RESERVATION;
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
      const uuid = await this.db.txAs({ orgId: request.orgId, userId: null }, (tx) =>
        this.repo.reserve(tx, request.orgId, Math.floor(request.bytes), request.category, expiresAt),
      );
      return new LiveReservation(this, request.orgId, uuid, Math.floor(request.bytes), request.category);
    } catch (err) {
      meterFailedOpen('reserve', request.orgId, err);
      return NO_RESERVATION;
    }
  }

  async recordRemoved(orgId: number, key: string, tx?: Tx): Promise<void> {
    try {
      if ((await this.mode.current()) === 'off') return;
      await this.inTenantTx(orgId, tx, (t) => this.repo.remove(t, orgId, key));
    } catch (err) {
      meterFailedOpen('remove', orgId, err);
    }
  }

  /** @internal used by the reservation this service hands out. */
  async settle(
    orgId: number,
    reservationUuid: string,
    bytes: number,
    category: StorageCategory,
    input: StorageCommit,
    tx?: Tx,
  ): Promise<void> {
    try {
      await this.inTenantTx(orgId, tx, (t) =>
        this.repo.commit(t, {
          orgId,
          reservationUuid,
          bytes,
          category,
          key: input.key,
          sha256: input.sha256 ?? null,
          ownerTable: input.ownerTable ?? null,
          ownerId: input.ownerId ?? null,
        }),
      );
    } catch (err) {
      meterFailedOpen('commit', orgId, err);
    }
  }

  /** @internal */
  async giveBack(orgId: number, reservationUuid: string): Promise<void> {
    try {
      await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.release(tx, orgId, reservationUuid));
    } catch (err) {
      meterFailedOpen('release', orgId, err);
    }
  }

  /**
   * In the caller's transaction when it has one, inside a savepoint: a metering statement that fails rolls back to the savepoint and the
   * caller's transaction (the message and its attachment) carries on. Without one, in a transaction of its own.
   */
  private inTenantTx<T>(orgId: number, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (tx) return tx.transaction((savepoint) => fn(savepoint as unknown as Tx));
    return this.db.txAs({ orgId, userId: null }, fn);
  }
}

class LiveReservation implements StorageReservation {
  private settled = false;

  constructor(
    private readonly meter: StorageMeterService,
    private readonly orgId: number,
    private readonly uuid: string,
    private readonly bytes: number,
    private readonly category: StorageCategory,
  ) {}

  async commit(input: StorageCommit, tx?: Tx): Promise<void> {
    await this.meter.settle(this.orgId, this.uuid, this.bytes, this.category, input, tx);
    // In the caller's transaction the commit is only as durable as that transaction: if it rolls back, the reservation row comes back
    // and `release()` must still be able to give it up. Alone, the commit is final.
    if (!tx) this.settled = true;
  }

  async release(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    await this.meter.giveBack(this.orgId, this.uuid);
  }
}

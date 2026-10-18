import { Logger } from '@nestjs/common';
import { ERROR_CODES, type StorageCategory } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { getRuntimeMonitor } from '@crm/observability';

/**
 * The storage quota guard, as the places that write a file see it (docs/specs/storage-quota-and-archival.md section 6.1).
 *
 * A port, because the two write doors live in `infra/` (`ChatMediaStore`, the training file adapter) and in a domain module
 * (`MediaStorageService`), and neither may import the quota module: the quota module imports the plans domain, which imports the
 * settings domain, which owns `MediaStorageService`. The quota module (`modules/storage-quota`) binds `STORAGE_METER` globally; a
 * door injects it as OPTIONAL, so a unit test or a process that does not load the quota module stores files exactly as before.
 *
 * The protocol is reserve, write, commit:
 *
 *   const reservation = await meter.reserve({ orgId, bytes, category });
 *   try { await write(); await reservation.commit({ key }); } catch (err) { await reservation.release(); throw err; }
 *
 * OBSERVE MODE (phases S0 and S1, the only mode built) NEVER REFUSES AND NEVER THROWS. Every step is fail-open: if measuring fails
 * the file write goes on, the failure is logged and counted (`crm_storage_meter_failures_total`), and the nightly counter check
 * corrects the drift. Enforce mode (phase S2) will make `reserve` throw `AppError(STORAGE_QUOTA_EXCEEDED, 422)` for a counted kind
 * at the limit; a door must therefore let a rejection of `reserve` propagate and must not wrap it in its own catch-all.
 */
export const STORAGE_METER = Symbol('STORAGE_METER');

export interface StorageReserveRequest {
  orgId: number;
  /** Counted by the server (buffer length, the spool counter), never taken from a client. */
  bytes: number;
  category: StorageCategory;
}

export interface StorageCommit {
  /** The object key, or `pg:<table>:<id>` for a Postgres blob. */
  key: string;
  sha256?: string | null;
  /** The row that owns the object. Omit when the caller does not have it yet: the registry row stays `pending` until the reconcile links it. */
  ownerTable?: string;
  ownerId?: number;
}

export interface StorageReservation {
  /**
   * Moves the reserved bytes to hot and upserts the registry row. In `tx` (the caller's transaction) when given, so the owner row and the
   * registry row commit together; the writes then run inside a savepoint, so a metering failure cannot abort the caller's transaction.
   * Idempotent: committing the same key again corrects its size instead of counting it twice.
   */
  commit(input: StorageCommit, tx?: Tx): Promise<void>;
  /** Gives the reservation back (the write failed). Idempotent; the reaper covers a crash before it runs. */
  release(): Promise<void>;
}

export interface StorageMeter {
  reserve(request: StorageReserveRequest): Promise<StorageReservation>;
  /** An object was deleted: drops its registry row and gives its bytes back. Idempotent (a second call finds no row). Never throws in observe mode. */
  recordRemoved(orgId: number, key: string, tx?: Tx): Promise<void>;
}

/** A reservation that does nothing: what a door gets when no meter is bound, when the mode is off, or when metering failed open. */
export const NO_RESERVATION: StorageReservation = {
  commit: () => Promise.resolve(),
  release: () => Promise.resolve(),
};

const logger = new Logger('StorageMeter');

/** An error that is a deliberate refusal (enforce mode, phase S2) and so must reach the caller. Anything else is a metering fault. */
export function isQuotaRefusal(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === ERROR_CODES.STORAGE_QUOTA_EXCEEDED
  );
}

/**
 * Fail-open bookkeeping for a metering step that threw: one error log (workspace and step, never a name, a number or the key's
 * file name) and one count, then the caller carries on. Exported so the doors and the meter itself fail the same way.
 */
export function meterFailedOpen(step: string, orgId: number | null, err: unknown): void {
  logger.error(
    { step, orgId, err: err instanceof Error ? err.message : String(err) },
    'storage metering failed; the file operation went on without it (fail-open)',
  );
  try {
    getRuntimeMonitor()?.observeStorageMeterFailure(step);
  } catch {
    // the counter is the last thing allowed to fail
  }
}

/** Wraps a reservation so that no step of it can throw into the file write it belongs to. */
function failOpenReservation(inner: StorageReservation, orgId: number): StorageReservation {
  return {
    commit: async (input, tx) => {
      try {
        await inner.commit(input, tx);
      } catch (err) {
        meterFailedOpen('commit', orgId, err);
      }
    },
    release: async () => {
      try {
        await inner.release();
      } catch (err) {
        meterFailedOpen('release', orgId, err);
      }
    },
  };
}

/**
 * `reserve` on an optional meter, for a door. No meter: no reservation. A meter that throws something other than a quota refusal
 * (a database fault, a bug) is treated as absent for this one write, which is what makes observe mode provably non-blocking even if a
 * meter implementation is wrong. A quota refusal (enforce mode only) propagates.
 */
export async function reserveOn(
  meter: StorageMeter | undefined,
  request: StorageReserveRequest,
): Promise<StorageReservation> {
  if (!meter) return NO_RESERVATION;
  try {
    return failOpenReservation(await meter.reserve(request), request.orgId);
  } catch (err) {
    if (isQuotaRefusal(err)) throw err;
    meterFailedOpen('reserve', request.orgId, err);
    return NO_RESERVATION;
  }
}

/** `recordRemoved` on an optional meter, fail-open. */
export async function recordRemovedOn(
  meter: StorageMeter | undefined,
  orgId: number,
  key: string,
  tx?: Tx,
): Promise<void> {
  if (!meter) return;
  try {
    await meter.recordRemoved(orgId, key, tx);
  } catch (err) {
    meterFailedOpen('remove', orgId, err);
  }
}

/**
 * Runs a file write between a reservation and its commit: reserve, `write`, commit with the key `write` returns. A failed write releases
 * the reservation and rethrows. The commit and release cannot throw (fail-open), so a metering failure can never fail `write`.
 */
export async function meteredWrite<T>(
  meter: StorageMeter | undefined,
  request: StorageReserveRequest,
  write: () => Promise<T>,
  commit: (written: T) => StorageCommit,
): Promise<T> {
  const reservation = await reserveOn(meter, request);
  let written: T;
  try {
    written = await write();
  } catch (err) {
    await reservation.release();
    throw err;
  }
  await reservation.commit(commit(written));
  return written;
}

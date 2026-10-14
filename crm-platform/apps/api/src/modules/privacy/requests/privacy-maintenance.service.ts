import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../../infra/db/database.service';
import { PrivacyRequestsRepository } from './privacy-requests.repository';

/** An export `running` this long has lost its worker. */
const STUCK_EXPORT_MS = 60 * 60_000;
/** A request not verified this many days after its due date is closed as expired. */
const EXPIRE_GRACE_DAYS = 30;
const FILE_BATCH = 500;

/**
 * The worker-side keeper of the rights service (privileged: it works across workspaces and writes the platform-owned purge queue):
 *
 *  - every minute, moves the storage keys an erasure found (`privacy_erasure_files`, written under the tenant policy) to the platform
 *    purge queue, whose worker deletes the bytes. An erasure is not complete until that queue is empty.
 *  - daily, deletes the file of an export past its week (the row stays, `expired`), fails an export whose worker died, and closes a
 *    request nobody verified long after its due date.
 */
@Injectable()
export class PrivacyMaintenanceService {
  private readonly logger = new Logger(PrivacyMaintenanceService.name);
  private movingFiles = false;
  private sweeping = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PrivacyRequestsRepository,
  ) {}

  @Cron('* * * * *')
  async moveFiles(): Promise<void> {
    if (this.movingFiles) return;
    this.movingFiles = true;
    try {
      await this.drainFiles();
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message },
        '[PRIVACY] moving erased files to the purge queue failed',
      );
    } finally {
      this.movingFiles = false;
    }
  }

  /** Public for tests: moves every pending key, returns how many. */
  async drainFiles(): Promise<number> {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const n = await this.db.privileged((tx) => this.repo.moveFilesToPurgeQueue(tx, FILE_BATCH));
      total += n;
      if (n < FILE_BATCH) break;
    }
    if (total > 0) this.logger.log({ files: total }, '[PRIVACY] erased files queued for deletion');
    return total;
  }

  @Cron('47 2 * * *')
  async sweepDaily(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const out = await this.sweep();
      if (out.expiredExports + out.failedExports + out.expiredRequests > 0) {
        this.logger.log(out, '[PRIVACY] daily sweep');
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, '[PRIVACY] daily sweep failed');
    } finally {
      this.sweeping = false;
    }
  }

  async sweep(): Promise<{
    expiredExports: number;
    failedExports: number;
    expiredRequests: number;
  }> {
    const expiredExports = await this.db.privileged((tx) => this.repo.expireExports(tx));
    const failedExports = await this.db.privileged((tx) =>
      this.repo.failStuckExports(tx, STUCK_EXPORT_MS),
    );
    const expiredRequests = (
      await this.db.privileged((tx) => this.repo.expireOverdue(tx, EXPIRE_GRACE_DAYS))
    ).length;
    return { expiredExports, failedExports, expiredRequests };
  }
}

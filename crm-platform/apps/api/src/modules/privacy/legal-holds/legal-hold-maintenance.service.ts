import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { SubjectResolver } from '../engine/subject-resolver';
import { ErasureExecutor } from '../requests/erasure-executor';
import { referenceOf } from '../requests/privacy-requests.mapper';
import { PrivacyRequestsRepository } from '../requests/privacy-requests.repository';
import { storedSubjectOf } from '../requests/request-subject';
import { LegalHoldGuard } from './legal-hold.guard';
import { LegalHoldsRepository } from './legal-holds.repository';
import { LegalHoldsService } from './legal-holds.service';

const BATCH = 50;

/**
 * The worker side of the legal holds (BL-295, docs/specs/legal-hold.md section 4), every minute:
 *
 *  1. ends the holds past their end date (as a release by the system);
 *  2. executes the erasures a person had confirmed while the hold was active, now that nothing holds the person any more. The person
 *     already typed the confirmation phrase; the hold was the only reason it waited, so it is not asked again. The erasure runs on fresh
 *     counts and writes the usual proof marked `resumedAfterHold`. A case that fails is taken back to a normal open case (its recorded
 *     confirmation is dropped) so it is never retried in a loop and staff run it by hand.
 *
 * Privileged for the list of candidates; each case is its own tenant transaction.
 */
@Injectable()
export class LegalHoldMaintenanceService {
  private readonly logger = new Logger(LegalHoldMaintenanceService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly holds: LegalHoldsService,
    private readonly holdsRepo: LegalHoldsRepository,
    private readonly requests: PrivacyRequestsRepository,
    private readonly resolver: SubjectResolver,
    private readonly guard: LegalHoldGuard,
    private readonly executor: ErasureExecutor,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.holds.expireDue();
      const resumed = await this.resumeConfirmed();
      if (expired + resumed.resumed + resumed.deferred + resumed.failed > 0) {
        this.logger.log({ expired, ...resumed }, '[LEGAL-HOLD] maintenance');
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, '[LEGAL-HOLD] maintenance failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests: executes every confirmed erasure that no hold covers any more. */
  async resumeConfirmed(): Promise<{ resumed: number; deferred: number; failed: number }> {
    const due = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, uuid FROM privacy_requests
         WHERE status = 'in_progress' AND request_type = 'erasure' AND erasure_confirmed_at IS NOT NULL AND restricted_at IS NULL
         ORDER BY erasure_confirmed_at LIMIT ${BATCH}`);
      return (res.rows as Array<{ org_id: number | string; uuid: string }>).map((r) => ({
        orgId: Number(r.org_id),
        uuid: r.uuid,
      }));
    });
    const out = { resumed: 0, deferred: 0, failed: 0 };
    for (const d of due) {
      try {
        const result = await this.resumeOne(d.orgId, d.uuid);
        if (result) out[result] += 1;
      } catch (err) {
        out.failed += 1;
        this.logger.error(
          { orgId: d.orgId, err: (err as Error).message },
          '[LEGAL-HOLD] resumed erasure failed',
        );
        await this.giveUp(d.orgId, d.uuid).catch(() => undefined);
      }
    }
    return out;
  }

  private resumeOne(orgId: number, uuid: string): Promise<'resumed' | 'deferred' | null> {
    const ctx = {
      requestId: randomUUID(),
      orgId,
      actorType: 'system' as const,
      actorId: null,
      userId: null,
    };
    return RequestContextStore.run(ctx, () =>
      this.db.txAs({ orgId, userId: null }, async (tx) => {
        const row = await this.requests.byUuid(tx, orgId, uuid, { lock: true });
        if (
          !row ||
          row.status !== 'in_progress' ||
          row.requestType !== 'erasure' ||
          row.erasureConfirmedAt === null ||
          row.restrictedAt !== null
        ) {
          return null;
        }
        const stored = storedSubjectOf(row, this.crypto);
        if (!stored) {
          // The person is gone already (deleted by other means): there is nothing to execute; leave the case to staff.
          await this.requests.addEvent(tx, orgId, row.id, {
            type: 'resume_skipped',
            actorUserId: null,
            detail: { reason: 'subject_gone' },
          });
          await tx.execute(
            sql`UPDATE privacy_requests SET erasure_confirmed_at = NULL, erasure_confirmed_by = NULL WHERE org_id = ${orgId} AND id = ${row.id}`,
          );
          return null;
        }
        const subject = await this.resolver.resolve(tx, orgId, stored);
        if (await this.guard.subjectHeld(tx, orgId, subject)) {
          // Another hold arrived between the release and this run: the case waits again.
          const hold = await this.holdsRepo.coveringHold(tx, orgId, subject);
          await this.requests.restrict(tx, orgId, row.id, { holdId: hold?.id ?? null });
          await this.requests.addEvent(tx, orgId, row.id, {
            type: 'restricted',
            actorUserId: null,
            detail: {},
          });
          return 'deferred';
        }
        await this.executor.execute(tx, {
          orgId,
          row,
          subject,
          mode: row.historyMode === 'anonymise' ? 'anonymise' : 'delete',
          actorUserId: row.erasureConfirmedBy,
          previewed: null,
          resumedAfterHold: true,
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'privacy_requests',
          aggregateId: row.id,
          eventType: 'privacy_request.resumed_erased',
          payload: { uuid: row.uuid, reference: referenceOf(row.uuid) },
          orgId,
        });
        return 'resumed';
      }),
    );
  }

  /** A resumed erasure that threw: drop the stored confirmation so it is not retried every minute, and tell the case's history. */
  private async giveUp(orgId: number, uuid: string): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.requests.byUuid(tx, orgId, uuid, { lock: true });
      if (!row || row.erasureConfirmedAt === null) return;
      await tx.execute(
        sql`UPDATE privacy_requests SET erasure_confirmed_at = NULL, erasure_confirmed_by = NULL WHERE org_id = ${orgId} AND id = ${row.id}`,
      );
      await this.requests.addEvent(tx, orgId, row.id, {
        type: 'resume_failed',
        actorUserId: null,
        detail: {},
      });
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { legalHoldActive } from '../../../common/errors/legal-hold.error';
import { DatabaseService } from '../../../infra/db/database.service';
import { bigintArray } from '../registry/sql';
import type { ResolvedSubject } from '../registry/types';

/** The advisory-lock class of "legal hold of workspace N": a hold being placed takes it exclusively, every purge takes it shared. */
const LOCK_CLASS = 7_301_995;

export {
  LEGAL_HOLD_BLOCKED_MESSAGE,
  legalHoldActive,
  isLegalHoldDbError,
} from '../../../common/errors/legal-hold.error';

export type HoldedOperation =
  | 'erasure'
  | 'contact_delete'
  | 'contact_bulk_delete'
  | 'contact_merge'
  | 'lead_delete'
  | 'workspace_wipe'
  | 'retention_sweep'
  | 'import_overwrite';

/**
 * The one guard every purge path asks (docs/specs/legal-hold.md section 5): "is this person, or this workspace, under a legal hold?".
 * The rule itself lives in the database function `is_subject_held`, so this class and the SQL fragments of the sweeps give the same answer.
 *
 * Every `assert*` and `held*` method takes the caller's transaction and first takes the workspace's hold lock in SHARED mode. Placing a
 * hold takes the same lock exclusively, so a purge that is already running finishes before the hold is placed, and a purge that starts
 * after sees it. Purges do not wait for each other.
 *
 * A refused operation answers `409 LEGAL_HOLD_ACTIVE` with a neutral message and leaves an audit row in a separate transaction (the
 * refusing transaction rolls back, and an auditor must still see that someone tried).
 */
@Injectable()
export class LegalHoldGuard {
  private readonly logger = new Logger(LegalHoldGuard.name);

  constructor(private readonly db: DatabaseService) {}

  /** Shared hold lock for the workspace, for the rest of the transaction. */
  async lockShared(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${LOCK_CLASS}, ${lockKey(orgId)})`);
  }

  /** Exclusive hold lock: used by the code that places or ends a hold. */
  async lockExclusive(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_CLASS}, ${lockKey(orgId)})`);
  }

  /** The ids (of the given ones) that are under a hold. */
  async heldContactIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    await this.lockShared(tx, orgId);
    const res = await tx.execute(sql`
      SELECT c AS id FROM unnest(${bigintArray(ids)}) AS c WHERE is_subject_held(${orgId}::bigint, 'contact', c)`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  async heldLeadIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    await this.lockShared(tx, orgId);
    const res = await tx.execute(sql`
      SELECT l AS id FROM unnest(${bigintArray(ids)}) AS l WHERE is_subject_held(${orgId}::bigint, 'lead', l)`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /** True when a workspace-wide hold (or the operator's) covers everything in the workspace. */
  async workspaceHeld(tx: Tx, orgId: number): Promise<boolean> {
    await this.lockShared(tx, orgId);
    const res = await tx.execute(
      sql`SELECT is_subject_held(${orgId}::bigint, 'contact', NULL) AS held`,
    );
    return (res.rows[0] as { held: boolean }).held === true;
  }

  /** Any active hold at all in the workspace: a wholesale wipe would delete the held records too. */
  async orgHasHold(tx: Tx, orgId: number): Promise<boolean> {
    await this.lockShared(tx, orgId);
    const res = await tx.execute(sql`SELECT org_has_active_legal_hold(${orgId}::bigint) AS held`);
    return (res.rows[0] as { held: boolean }).held === true;
  }

  /** Is anyone the resolved person stands for (their contacts, their leads, or the whole workspace) under a hold? */
  async subjectHeld(tx: Tx, orgId: number, subject: ResolvedSubject): Promise<boolean> {
    if (await this.workspaceHeld(tx, orgId)) return true;
    if ((await this.heldContactIds(tx, orgId, subject.contactIds)).length > 0) return true;
    return (await this.heldLeadIds(tx, orgId, subject.leadIds)).length > 0;
  }

  /** Throws `LEGAL_HOLD_ACTIVE` when any of these contacts is held. */
  async assertContactsNotHeld(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    operation: HoldedOperation,
  ): Promise<void> {
    const held = await this.heldContactIds(tx, orgId, ids);
    if (held.length > 0) await this.refuse(orgId, operation, held.length);
  }

  async assertLeadsNotHeld(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    operation: HoldedOperation,
  ): Promise<void> {
    const held = await this.heldLeadIds(tx, orgId, ids);
    if (held.length > 0) await this.refuse(orgId, operation, held.length);
  }

  async assertSubjectNotHeld(
    tx: Tx,
    orgId: number,
    subject: ResolvedSubject,
    operation: HoldedOperation,
  ): Promise<void> {
    if (await this.subjectHeld(tx, orgId, subject)) await this.refuse(orgId, operation, 1);
  }

  async assertOrgNotHeld(tx: Tx, orgId: number, operation: HoldedOperation): Promise<void> {
    if (await this.orgHasHold(tx, orgId)) await this.refuse(orgId, operation, 1);
  }

  /** The error of a refused purge. `count` is how many of the requested records are held (shown to the caller, never who they are). */
  async refuse(orgId: number, operation: HoldedOperation, count: number): Promise<never> {
    await this.logRefusal(orgId, operation, count);
    throw legalHoldActive(count);
  }

  /** Best effort, in its own transaction: a failed audit write must not turn a refusal into a 500. */
  private async logRefusal(
    orgId: number,
    operation: HoldedOperation,
    count: number,
  ): Promise<void> {
    try {
      const ctx = RequestContextStore.peek();
      await this.db.txAs({ orgId, userId: ctx?.userId ?? null }, (tx) =>
        tx.execute(sql`
          INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
          VALUES (${orgId}, ${ctx?.actorId ?? null}, ${ctx?.actorType ?? 'system'}, 'legal_holds', 0, 'read',
                  ${JSON.stringify({ blocked: { old: null, new: { operation, records: count } } })}::jsonb, ${ctx?.requestId ?? null})`),
      );
    } catch (err) {
      this.logger.warn({ orgId, operation, err: String(err) }, '[LEGAL-HOLD] refusal not audited');
    }
  }
}

/** A 32-bit key for the advisory lock of one workspace. */
function lockKey(orgId: number): number {
  return Math.abs(orgId % 2_147_483_647);
}

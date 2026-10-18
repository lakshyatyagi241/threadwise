import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { PrivacyErasureLine, PrivacyErasureReport, PrivacyHistoryMode } from '@crm/contracts';
import { eraseSpec } from '../registry/define';
import { registeredSpecs } from '../registry';
import { linkKinds } from '../registry/sql';
import type { PrivacyCtx, ResolvedSubject, TableSpec, Tier } from '../registry/types';
import { RequestContextStore } from '../../../common/context/request-context';
import { SubjectResolver } from './subject-resolver';

/** A rights erasure covers every tier. */
export const ALL_TIERS: readonly Tier[] = ['subject', 'core', 'history', 'records', 'financial'];
/**
 * Deleting a contact in the CRM: the person's own data and their conversation history go with the contact. The contact row itself is
 * deleted by the CRM (it decides who won a race and writes the audit row), and the business records (leads, deals, tasks, invoices) stay.
 */
export const CONTACT_DELETE_TIERS: readonly Tier[] = ['core', 'history'];
/** A staff member's derived copies (revenue export files, AI briefs) are `core` tier tables linked by `user`. */
export const STAFF_ERASE_TIERS: readonly Tier[] = ['core'];

export interface ErasureRun {
  report: PrivacyErasureReport;
  /** Distinct object-storage keys found; with `dryRun: false` they are queued in `privacy_erasure_files` in this transaction. */
  files: number;
}

/**
 * The one erasure pipeline. It runs every registered table of the chosen tiers in the registry's global order (an event table read
 * through its messages runs before the messages, the contact row last), inside the transaction it is given: either the whole erasure
 * happens or none of it. A dry run takes the same path with every write replaced by a count, so the numbers it returns are the ones the
 * execution produces.
 *
 * Called by the rights service (`PrivacyRequestsService.erase`) and by the CRM's contact delete (single and bulk). It never logs a row
 * value, only counts.
 */
@Injectable()
export class PersonalDataErasureService {
  constructor(private readonly resolver: SubjectResolver) {}

  async run(
    tx: Tx,
    params: {
      orgId: number;
      requestId: number | null;
      subject: ResolvedSubject;
      tiers: readonly Tier[];
      mode: PrivacyHistoryMode;
      dryRun: boolean;
      now?: Date;
      /** Run only the tables this accepts (the staff entry point runs the tables linked to a staff member and nothing else). */
      only?: (spec: TableSpec) => boolean;
    },
  ): Promise<ErasureRun> {
    const now = params.now ?? new Date();
    const ctx: PrivacyCtx = {
      tx,
      orgId: params.orgId,
      requestId: params.requestId,
      tiers: params.tiers,
      dryRun: params.dryRun,
      now,
    };
    const lines: PrivacyErasureLine[] = [];
    let files = 0;
    for (const { holder, spec } of registeredSpecs()) {
      if (params.only && !params.only(spec)) continue;
      const done = await eraseSpec(holder.key, spec, ctx, params.subject, params.mode);
      if (!done) continue;
      lines.push(done.line);
      files += done.files;
      if (spec.audited && !params.dryRun && done.line.count > 0) {
        await this.auditPurge(
          tx,
          params.orgId,
          params.requestId,
          params.subject,
          spec,
          done.line.count,
        );
      }
    }
    const sum = (...kinds: PrivacyErasureLine['disposition'][]) =>
      lines.filter((l) => kinds.includes(l.disposition)).reduce((n, l) => n + l.count, 0);
    return {
      files,
      report: {
        dryRun: params.dryRun,
        lines,
        files,
        totals: {
          deleted: sum('deleted', 'cascaded'),
          anonymised: sum('anonymised'),
          retained: sum('retained', 'unlinked'),
        },
        historyMode: params.mode,
        at: now.toISOString(),
      },
    };
  }

  /**
   * A staff member is erased (their account is deleted): their derived copies go with them, found through the registry (the revenue
   * export files they asked for or were mailed, the AI briefs they generated). The stored file of an export lives in the row
   * (`file_gz`), so deleting the row deletes the file; nothing is queued for the object store. The users row itself, their login and
   * their sessions are not handled here (the foreign keys cascade the two tables at the moment the user is deleted, as a second layer).
   */
  async eraseStaff(
    tx: Tx,
    orgId: number,
    userIds: readonly number[],
    now?: Date,
  ): Promise<ErasureRun> {
    const subject = await this.resolver.fromUsers(tx, orgId, userIds);
    return this.run(tx, {
      orgId,
      requestId: null,
      subject,
      tiers: STAFF_ERASE_TIERS,
      mode: 'delete',
      dryRun: false,
      now,
      only: (spec) => linkKinds(spec).has('user') && spec.disposition === 'delete',
    });
  }

  /**
   * One audit row for rows a registry table lost to an erasure: the table as module, what caused it, the count. Never a value. The
   * actor is whoever the request is made by; a run outside a request (a job) is the system.
   */
  private async auditPurge(
    tx: Tx,
    orgId: number,
    requestId: number | null,
    subject: ResolvedSubject,
    spec: TableSpec,
    count: number,
  ): Promise<void> {
    const ctx = RequestContextStore.peek();
    const cause = subject.userIds.length
      ? 'staff_erased'
      : requestId === null
        ? 'contact_deleted'
        : 'rights_request';
    const recordId = requestId ?? subject.userIds[0] ?? subject.contactIds[0] ?? 0;
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${orgId}, ${ctx?.actorId ?? null}, ${ctx?.actorType ?? 'system'}, ${spec.table}, ${recordId}, 'delete',
              ${JSON.stringify({ rows: { old: count, new: 0 }, cause: { old: null, new: cause } })}::jsonb,
              ${ctx?.requestId ?? null})`);
  }

  /**
   * The CRM deletes these contacts: erase their conversations, files, recordings and call logs first, so nothing is left behind
   * pointing at a person who no longer exists. Returns the number of stored files queued for deletion.
   */
  async eraseContactHistory(
    tx: Tx,
    orgId: number,
    contactIds: readonly number[],
    mode: PrivacyHistoryMode,
  ): Promise<ErasureRun> {
    const subject = await this.resolver.fromContacts(tx, orgId, contactIds);
    const run = await this.run(tx, {
      orgId,
      requestId: null,
      subject,
      tiers: CONTACT_DELETE_TIERS,
      mode,
      dryRun: false,
    });
    // The AI scoring log is a records-tier table (kept when a contact is deleted, erased by a data request). Here the person's id,
    // name and the reasons written about them go; the cost row stays for billing and the cost report.
    await tx.execute(sql`
      UPDATE lead_scoring_runs SET contact_id = NULL, contact_name = NULL, reasons = NULL
      WHERE org_id = ${orgId}::bigint AND contact_id = ANY(${`{${contactIds.join(',')}}`}::bigint[])`);
    return run;
  }
}

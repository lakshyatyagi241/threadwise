import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { PrivacyErasureLine, PrivacyErasureReport, PrivacyHistoryMode } from '@crm/contracts';
import { eraseSpec } from '../registry/define';
import { registeredSpecs } from '../registry';
import type { PrivacyCtx, ResolvedSubject, Tier } from '../registry/types';
import { SubjectResolver } from './subject-resolver';

/** A rights erasure covers every tier. */
export const ALL_TIERS: readonly Tier[] = ['subject', 'core', 'history', 'records', 'financial'];
/**
 * Deleting a contact in the CRM: the person's own data and their conversation history go with the contact. The contact row itself is
 * deleted by the CRM (it decides who won a race and writes the audit row), and the business records (leads, deals, tasks, invoices) stay.
 */
export const CONTACT_DELETE_TIERS: readonly Tier[] = ['core', 'history'];

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
      const done = await eraseSpec(holder.key, spec, ctx, params.subject, params.mode);
      if (!done) continue;
      lines.push(done.line);
      files += done.files;
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

import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type PrivacyErasureReport, type PrivacyProof } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ALL_TIERS, PersonalDataErasureService } from '../engine/erasure.service';
import { registryDigest } from '../registry';
import type { ResolvedSubject } from '../registry/types';
import { referenceOf } from './privacy-requests.mapper';
import { PrivacyRequestsRepository, type RequestRow } from './privacy-requests.repository';

const MODULE_KEY = 'privacy_requests';

/** What an erasure cannot reach, written into every proof so the reader of it is not told more than was done. */
export const PROOF_NOTES = [
  'Backups keep erased data until they expire (14 days on the local disk, up to 12 months off-site); the erasure is re-applied after any restore.',
  'Providers that received messages or files (WhatsApp / Meta, SMS and email gateways, AI and translation vendors, payment gateways) keep their own copies under their own terms; see the sub-processor register.',
  'Financial records are kept for the statutory period with the buyer identity replaced; amounts, numbers, tax facts and dates stay.',
  'Consent events are kept as proof without a link to the person.',
];

/** Two reports agree when every (table, disposition) line holds the same number of rows. */
export function sameCounts(a: PrivacyErasureReport, b: PrivacyErasureReport): boolean {
  const key = (r: PrivacyErasureReport) =>
    r.lines
      .map((l) => `${l.holder}|${l.table}|${l.disposition}|${l.count}`)
      .sort()
      .join('\n') + `\nfiles=${r.files}`;
  return key(a) === key(b);
}

const stateError = (message: string) =>
  new AppError(ERROR_CODES.PRIVACY_REQUEST_STATE_INVALID, message, HttpStatus.CONFLICT);

/**
 * The execution half of a rights erasure: run the pipeline, write the proof, the events, the audit rows and the outbox events. Shared by
 * the request the staff confirms (`PrivacyRequestsService.erase`) and the worker that resumes a confirmed erasure after a legal hold ended
 * (BL-295). It never decides WHETHER to erase (the preview, the confirmation phrase and the legal-hold guard are the callers' business);
 * it does what it was asked, inside the transaction it is given.
 */
@Injectable()
export class ErasureExecutor {
  constructor(
    private readonly repo: PrivacyRequestsRepository,
    private readonly eraser: PersonalDataErasureService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(
    tx: Tx,
    p: {
      orgId: number;
      row: RequestRow;
      subject: ResolvedSubject;
      mode: 'delete' | 'anonymise';
      actorUserId: number | null;
      /** The preview the person confirmed: the execution must match it. Null when the confirmation was given long ago (a resumed erasure). */
      previewed: PrivacyErasureReport | null;
      resumedAfterHold: boolean;
    },
  ): Promise<PrivacyErasureReport> {
    const { orgId, row, subject } = p;
    const base = {
      orgId,
      requestId: row.id,
      subject,
      tiers: ALL_TIERS,
      mode: p.mode,
    } as const;
    const doomed = await this.contactsOf(tx, orgId, subject.contactIds);
    const run = await this.eraser.run(tx, { ...base, dryRun: false });
    if (p.previewed && !sameCounts(run.report, p.previewed)) {
      // Cannot happen inside one transaction without a concurrent writer; if it does, nothing is kept.
      throw stateError(
        'The erasure did not match its preview and was rolled back. Preview it again.',
      );
    }

    const executedAt = new Date();
    const userUuid =
      p.actorUserId === null ? null : await this.repo.userUuid(tx, orgId, p.actorUserId);
    const body: Omit<PrivacyProof, 'sha256'> = {
      requestReference: referenceOf(row.uuid),
      requestType: row.requestType as PrivacyProof['requestType'],
      executedAt: executedAt.toISOString(),
      executedBy: userUuid,
      historyMode: p.mode,
      lines: run.report.lines,
      files: run.report.files,
      registryDigest: registryDigest(),
      notes: PROOF_NOTES,
      // Only a resumed erasure says so; the proof of an ordinary one is byte for byte what it always was.
      ...(p.resumedAfterHold ? { resumedAfterHold: true } : {}),
    };
    const sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await this.repo.saveErasure(tx, orgId, row.id, {
      result: {
        totals: run.report.totals,
        files: run.report.files,
        executedAt: executedAt.toISOString(),
        matchedPreview: p.previewed !== null,
        ...(p.resumedAfterHold ? { resumedAfterHold: true } : {}),
      },
      proof: { ...body, sha256 },
      proofSha256: sha256,
    });
    await this.repo.addEvent(tx, orgId, row.id, {
      type: 'erased',
      from: 'in_progress',
      to: 'completed',
      actorUserId: p.actorUserId,
      detail: {
        ...run.report.totals,
        files: run.report.files,
        proofSha256: sha256,
        ...(p.resumedAfterHold ? { resumedAfterHold: true } : {}),
      },
    });
    // The contacts were deleted by the pipeline, not by the CRM's delete: the audit row and the event the rest of the system listens to
    // (webhooks, segments, flows) are written here, exactly as a CRM delete writes them.
    for (const c of doomed) {
      await this.audit.record(tx, { module: 'contacts', recordId: c.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: 'contacts',
        aggregateId: c.id,
        eventType: 'contact.deleted',
        payload: { uuid: c.uuid, displayId: c.displayId },
        orgId,
      });
    }
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: row.id,
      action: 'delete',
      delta: { status: { old: 'in_progress', new: 'completed' } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType: 'privacy_request.erased',
      payload: {
        uuid: row.uuid,
        reference: referenceOf(row.uuid),
        ...run.report.totals,
        files: run.report.files,
        ...(p.resumedAfterHold ? { resumedAfterHold: true } : {}),
      },
      orgId,
    });
    return run.report;
  }

  private async contactsOf(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
  ): Promise<Array<{ id: number; uuid: string; displayId: string | null }>> {
    if (!ids.length) return [];
    const res = await tx.execute(sql`
      SELECT id, uuid, display_id FROM contacts WHERE org_id = ${orgId} AND id = ANY(${`{${ids.join(',')}}`}::bigint[])`);
    return (
      res.rows as Array<{ id: number | string; uuid: string; display_id: string | null }>
    ).map((r) => ({ id: Number(r.id), uuid: r.uuid, displayId: r.display_id }));
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ExtendLegalHoldInput,
  type ListLegalHoldsQuery,
  type LegalHold,
  type LegalHoldDetail,
  type LegalHoldList,
  type LegalHoldStatusResponse,
  type PlaceLegalHoldInput,
  type ReleaseLegalHoldInput,
  type ReleaseLegalHoldResult,
  type ReviewLegalHoldInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { RequestContextStore } from '../../../common/context/request-context';
import { buildCsv } from '../../../common/csv';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { SubjectResolver } from '../engine/subject-resolver';
import { maskSubject, referenceOf } from '../requests/privacy-requests.mapper';
import { PrivacyRequestsRepository } from '../requests/privacy-requests.repository';
import { storedSubjectOf } from '../requests/request-subject';
import type { ResolvedSubject } from '../registry/types';
import { LegalHoldGuard } from './legal-hold.guard';
import { toHistoryEntry, toLegalHold } from './legal-holds.mapper';
import { LegalHoldsRepository, type HoldRow } from './legal-holds.repository';

const MODULE_KEY = 'legal_holds';
/** Holds the expiry sweep ends per run and workspace; the rest wait for the next run. */
const EXPIRY_BATCH = 200;

/** Who is acting: a person in a request, or the system (the expiry sweep). */
interface Actor {
  userId: number | null;
  actorType: string;
  actorId: number | null;
  requestId: string | null;
}

const notFound = () =>
  new AppError(ERROR_CODES.LEGAL_HOLD_NOT_FOUND, 'Legal hold not found', HttpStatus.NOT_FOUND);
const notActive = () =>
  new AppError(
    ERROR_CODES.LEGAL_HOLD_NOT_ACTIVE,
    'This hold has already ended.',
    HttpStatus.CONFLICT,
  );

/**
 * The legal-hold register (BL-295, docs/specs/legal-hold.md): place, extend, review and release a hold, the status of one person, and the
 * end of a hold by its date. Every write is one transaction with its audit row and its outbox event; none of them logs or returns a personal
 * value (a subject is a masked label, the note is PII-light by rule and never copied into an audit delta or an event).
 *
 * Placing and ending a hold take the workspace's hold lock exclusively, so a purge already running finishes first and one that starts
 * afterwards sees the hold (`LegalHoldGuard`).
 */
@Injectable()
export class LegalHoldsService {
  private readonly logger = new Logger(LegalHoldsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LegalHoldsRepository,
    private readonly requests: PrivacyRequestsRepository,
    private readonly resolver: SubjectResolver,
    private readonly guard: LegalHoldGuard,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
  ) {}

  // ---- place --------------------------------------------------------------------------------------------------------------------

  async place(input: PlaceLegalHoldInput): Promise<LegalHold> {
    const ctx = RequestContextStore.require();
    const actor = actorOf();
    const now = new Date();
    const reviewAt = input.reviewAt ? new Date(input.reviewAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw AppError.validation('The end date must be in the future.', [
        { path: 'expiresAt', message: 'must be in the future' },
      ]);
    }
    return this.db.tx(async (tx) => {
      await this.guard.lockExclusive(tx, ctx.orgId);
      // An expired hold still occupies its unique slot until the worker moves it: end it now, so the new hold is not refused for it.
      await this.endExpired(tx, ctx.orgId);

      let contactId: number | null = null;
      let leadId: number | null = null;
      let label = 'Whole workspace';
      if (input.scope === 'contact') {
        const c = await this.requests.contactByUuid(tx, ctx.orgId, input.subjectId!);
        if (!c) throw this.subjectNotFound();
        contactId = c.id;
        label = maskSubject(c);
      } else if (input.scope === 'lead') {
        const l = await this.requests.leadByUuid(tx, ctx.orgId, input.subjectId!);
        if (!l) throw this.subjectNotFound();
        leadId = l.id;
        label = maskSubject(l);
      }
      const existing = await this.repo.activeFor(
        tx,
        ctx.orgId,
        input.scope,
        input.scope === 'contact' ? contactId : leadId,
      );
      if (existing) {
        throw new AppError(
          ERROR_CODES.LEGAL_HOLD_EXISTS,
          'This subject already has an active legal hold. Extend it to add another matter.',
          HttpStatus.CONFLICT,
        );
      }
      const row = await this.repo.insert(tx, ctx.orgId, {
        scope: input.scope,
        contactId,
        leadId,
        subjectLabel: label,
        reasonCategory: input.reasonCategory,
        caseRef: input.caseRef,
        note: input.note ?? null,
        reviewAt,
        expiresAt,
        placedBy: ctx.userId,
      });
      const restricted = await this.restrictCases(tx, ctx.orgId, row, ctx.userId);
      await this.auditRow(tx, ctx.orgId, actor, row.id, 'insert', {
        scope: { old: null, new: row.scope },
        reasonCategory: { old: null, new: row.reasonCategory },
        caseRef: { old: null, new: row.caseRef },
        reviewAt: { old: null, new: row.reviewAt?.toISOString() ?? null },
        expiresAt: { old: null, new: row.expiresAt?.toISOString() ?? null },
        status: { old: null, new: 'active' },
        casesRestricted: { old: null, new: restricted },
      });
      await this.emit(tx, ctx.orgId, row, 'legal_hold.placed', { casesRestricted: restricted });
      return toLegalHold((await this.repo.byId(tx, ctx.orgId, row.id))!);
    });
  }

  // ---- read ---------------------------------------------------------------------------------------------------------------------

  async list(query: ListLegalHoldsQuery): Promise<LegalHoldList> {
    const ctx = RequestContextStore.require();
    const after = decodeCursor(query.cursor);
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query, after);
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const now = new Date();
      return {
        data: page.map((r) => toLegalHold(r, now)),
        page: {
          nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
          hasMore: rows.length > query.limit,
          limit: query.limit,
        },
      };
    });
  }

  async get(uuid: string): Promise<LegalHoldDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid);
      const history = await this.repo.history(tx, ctx.orgId, row.id);
      return { hold: toLegalHold(row), history: history.map(toHistoryEntry) };
    });
  }

  /** Is this contact or lead held, and by which hold? Backs the banner on the contact page (readers of the register only). */
  async status(kind: 'contact' | 'lead', uuid: string): Promise<LegalHoldStatusResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const subject =
        kind === 'contact'
          ? await this.requests.contactByUuid(tx, ctx.orgId, uuid)
          : await this.requests.leadByUuid(tx, ctx.orgId, uuid);
      if (!subject) throw this.subjectNotFound();
      const hold = await this.repo.coveringFor(tx, ctx.orgId, kind, subject.id);
      return {
        held: hold !== null,
        hold: hold ? toLegalHold(hold) : null,
        viaWorkspace: hold?.scope === 'workspace',
      };
    });
  }

  /** The register as a CSV for auditors, with the list's filters. Audited as an export. */
  async exportCsv(query: ListLegalHoldsQuery): Promise<{ csv: string; fileName: string }> {
    const ctx = RequestContextStore.require();
    const actor = actorOf();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query, undefined, 5000);
      const now = new Date();
      const csv = buildCsv(
        [
          'Hold reference',
          'Scope',
          'Subject',
          'Reason category',
          'Case reference',
          'Status',
          'Placed by',
          'Placed at',
          'Review by',
          'Last reviewed at',
          'Last reviewed by',
          'Expires at',
          'Ended at',
          'Ended by',
          'Release note',
          'Cases waiting',
        ],
        rows.map((r) => {
          const h = toLegalHold(r, now);
          return [
            referenceOfHold(r.uuid),
            h.scope,
            h.subjectLabel,
            h.reasonCategory,
            h.caseRef,
            h.status,
            h.placedBy,
            h.placedAt,
            h.reviewAt,
            h.lastReviewedAt,
            h.lastReviewedBy,
            h.expiresAt,
            h.releasedAt,
            h.releasedBy,
            h.releaseNote,
            h.restrictedCases,
          ];
        }),
      );
      await this.auditRow(tx, ctx.orgId, actor, 0, 'export', {
        rows: { old: null, new: rows.length },
      });
      return { csv, fileName: `legal-holds-${now.toISOString().slice(0, 10)}.csv` };
    });
  }

  // ---- change -------------------------------------------------------------------------------------------------------------------

  async extend(uuid: string, input: ExtendLegalHoldInput): Promise<LegalHold> {
    const ctx = RequestContextStore.require();
    const actor = actorOf();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (row.status !== 'active') throw notActive();
      const expiresAt =
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt
            ? new Date(input.expiresAt)
            : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw AppError.validation('The end date must be in the future.', [
          { path: 'expiresAt', message: 'must be in the future' },
        ]);
      }
      const reviewAt =
        input.reviewAt === undefined ? undefined : input.reviewAt ? new Date(input.reviewAt) : null;
      let caseRef: string | undefined;
      if (input.addCaseRef) {
        caseRef = `${row.caseRef}; ${input.addCaseRef}`;
        if (caseRef.length > 120) {
          throw AppError.validation('The case references are too long together (120 characters).', [
            { path: 'addCaseRef', message: 'too long' },
          ]);
        }
      }
      await this.repo.update(tx, ctx.orgId, row.id, {
        reviewAt,
        expiresAt,
        caseRef,
        note: input.note,
      });
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (reviewAt !== undefined)
        delta.reviewAt = {
          old: row.reviewAt?.toISOString() ?? null,
          new: reviewAt?.toISOString() ?? null,
        };
      if (expiresAt !== undefined)
        delta.expiresAt = {
          old: row.expiresAt?.toISOString() ?? null,
          new: expiresAt?.toISOString() ?? null,
        };
      if (caseRef !== undefined) delta.caseRef = { old: row.caseRef, new: caseRef };
      if (input.note !== undefined) delta.note = { old: null, new: 'changed' };
      await this.auditRow(tx, ctx.orgId, actor, row.id, 'update', delta);
      await this.emit(tx, ctx.orgId, row, 'legal_hold.extended');
      return toLegalHold((await this.repo.byId(tx, ctx.orgId, row.id))!);
    });
  }

  async review(uuid: string, input: ReviewLegalHoldInput): Promise<LegalHold> {
    const ctx = RequestContextStore.require();
    const actor = actorOf();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (row.status !== 'active') throw notActive();
      const next =
        input.nextReviewAt === undefined
          ? undefined
          : input.nextReviewAt
            ? new Date(input.nextReviewAt)
            : null;
      await this.repo.markReviewed(tx, ctx.orgId, row.id, {
        by: ctx.userId,
        nextReviewAt: next,
        note: input.note,
      });
      await this.auditRow(tx, ctx.orgId, actor, row.id, 'update', {
        reviewed: { old: row.lastReviewedAt?.toISOString() ?? null, new: new Date().toISOString() },
        ...(next !== undefined
          ? {
              reviewAt: {
                old: row.reviewAt?.toISOString() ?? null,
                new: next?.toISOString() ?? null,
              },
            }
          : {}),
      });
      await this.emit(tx, ctx.orgId, row, 'legal_hold.reviewed');
      return toLegalHold((await this.repo.byId(tx, ctx.orgId, row.id))!);
    });
  }

  async release(uuid: string, input: ReleaseLegalHoldInput): Promise<ReleaseLegalHoldResult> {
    const ctx = RequestContextStore.require();
    const actor = actorOf();
    return this.db.tx(async (tx) => {
      await this.guard.lockExclusive(tx, ctx.orgId);
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (row.status !== 'active') throw notActive();
      const lifted = await this.endHold(tx, ctx.orgId, row, {
        status: 'released',
        actor,
        note: input.reason ?? null,
      });
      return {
        hold: toLegalHold((await this.repo.byId(tx, ctx.orgId, row.id))!),
        casesLifted: lifted.lifted,
        erasuresResuming: lifted.resuming,
      };
    });
  }

  // ---- worker -------------------------------------------------------------------------------------------------------------------

  /**
   * Ends every hold past its end date, as if a person had released it (system actor): the cases it restricted leave the restriction and
   * the worker resumes the confirmed ones. Privileged: it works across workspaces; each hold is its own tenant transaction.
   */
  async expireDue(): Promise<number> {
    const due = await this.db.privileged((tx) => this.repo.dueForExpiry(tx, null, EXPIRY_BATCH));
    let ended = 0;
    for (const d of due) {
      try {
        const done = await this.db.txAs({ orgId: d.orgId, userId: null }, async (tx) => {
          await this.guard.lockExclusive(tx, d.orgId);
          const n = await this.endExpired(tx, d.orgId);
          return n;
        });
        ended += done;
      } catch (err) {
        this.logger.error({ orgId: d.orgId, err: String(err) }, '[LEGAL-HOLD] expiry failed');
      }
    }
    return ended;
  }

  // ---- shared pieces ------------------------------------------------------------------------------------------------------------

  /** Ends the workspace's holds that are past their end date. The caller holds the exclusive hold lock. */
  private async endExpired(tx: Tx, orgId: number): Promise<number> {
    const due = await this.repo.dueForExpiry(tx, orgId, EXPIRY_BATCH);
    for (const d of due) {
      const row = await this.repo.byId(tx, orgId, d.id);
      if (!row || row.status !== 'active') continue;
      await this.endHold(tx, orgId, row, { status: 'expired', actor: systemActor(), note: null });
    }
    return due.length;
  }

  /** Ends one hold and lifts the restriction of the cases that waited on it. The caller holds the exclusive hold lock. */
  private async endHold(
    tx: Tx,
    orgId: number,
    row: HoldRow,
    how: { status: 'released' | 'expired'; actor: Actor; note: string | null },
  ): Promise<{ lifted: number; resuming: number }> {
    await this.repo.end(tx, orgId, row.id, {
      status: how.status,
      by: how.actor.userId,
      note: how.note,
    });
    const lifted = await this.liftCases(tx, orgId, row, how.actor.userId);
    await this.auditRow(tx, orgId, how.actor, row.id, 'delete', {
      status: { old: 'active', new: how.status },
      casesLifted: { old: null, new: lifted.lifted },
      erasuresResuming: { old: null, new: lifted.resuming },
    });
    await this.emit(
      tx,
      orgId,
      row,
      how.status === 'released' ? 'legal_hold.released' : 'legal_hold.expired',
      { casesLifted: lifted.lifted, erasuresResuming: lifted.resuming },
    );
    return lifted;
  }

  /**
   * A hold begins: every open erasure case of the person is restricted in the same transaction. Cases that name a contact or a lead are
   * found by SQL; a case for a free phone or email is resolved first, because only then is it known whose it is.
   */
  private async restrictCases(
    tx: Tx,
    orgId: number,
    hold: HoldRow,
    userId: number | null,
  ): Promise<number> {
    const hit = await this.repo.restrictOpenErasures(tx, orgId, hold);
    for (const caseId of await this.repo.openIdentifierErasures(tx, orgId)) {
      const req = await this.requests.byId(tx, orgId, caseId);
      if (!req) continue;
      const stored = storedSubjectOf(req, this.crypto);
      if (!stored) continue;
      const subject = await this.resolver.resolve(tx, orgId, stored);
      if (!covers(hold, subject)) continue;
      await this.requests.restrict(tx, orgId, caseId, { holdId: hold.id });
      hit.push({ id: caseId, uuid: req.uuid });
    }
    for (const c of hit) {
      await this.requests.addEvent(tx, orgId, c.id, {
        type: 'restricted',
        actorUserId: userId,
        detail: {},
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'privacy_requests',
        aggregateId: c.id,
        eventType: 'privacy_request.restricted',
        payload: { uuid: c.uuid, reference: referenceOf(c.uuid), requestType: 'erasure' },
        orgId,
      });
    }
    return hit.length;
  }

  /**
   * A hold ends: the cases that waited on it leave the restriction, unless another hold still covers the person (they then keep waiting).
   * `resuming` counts those whose erasure a person had confirmed: the worker executes them next.
   */
  private async liftCases(
    tx: Tx,
    orgId: number,
    hold: HoldRow,
    userId: number | null,
  ): Promise<{ lifted: number; resuming: number }> {
    let lifted = 0;
    let resuming = 0;
    for (const caseId of await this.repo.restrictedBy(tx, orgId, hold.id)) {
      const req = await this.requests.byId(tx, orgId, caseId);
      if (!req) continue;
      const stored = storedSubjectOf(req, this.crypto);
      const subject = stored ? await this.resolver.resolve(tx, orgId, stored) : null;
      // The hold was ended a statement ago in this transaction, so the question below no longer counts it.
      if (subject && (await this.guard.subjectHeld(tx, orgId, subject))) {
        const other = await this.repo.coveringHold(tx, orgId, subject);
        await this.requests.restrict(tx, orgId, caseId, { holdId: other?.id ?? null });
        continue;
      }
      await this.requests.liftRestriction(tx, orgId, caseId);
      const confirmed = req.erasureConfirmedAt !== null;
      await this.requests.addEvent(tx, orgId, caseId, {
        type: 'restriction_lifted',
        actorUserId: userId,
        detail: { erasureConfirmed: confirmed },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'privacy_requests',
        aggregateId: caseId,
        eventType: 'privacy_request.resumed',
        payload: {
          uuid: req.uuid,
          reference: referenceOf(req.uuid),
          requestType: req.requestType,
          erasureConfirmed: confirmed,
        },
        orgId,
      });
      lifted += 1;
      if (confirmed) resuming += 1;
    }
    return { lifted, resuming };
  }

  private async auditRow(
    tx: Tx,
    orgId: number,
    actor: Actor,
    recordId: number,
    action: 'insert' | 'update' | 'delete' | 'export',
    delta: Record<string, { old: unknown; new: unknown }>,
  ): Promise<void> {
    await tx.execute(auditSql(orgId, actor, recordId, action, delta));
  }

  private emit(
    tx: Tx,
    orgId: number,
    row: HoldRow,
    eventType: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    // The scope and the category only: an event never carries the person, the case reference or the note.
    return this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      payload: { uuid: row.uuid, scope: row.scope, reasonCategory: row.reasonCategory, ...extra },
      orgId,
    });
  }

  private async mustFind(tx: Tx, orgId: number, uuid: string, lock = false): Promise<HoldRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid, { lock });
    if (!row) throw notFound();
    return row;
  }

  private subjectNotFound(): AppError {
    return new AppError(
      ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND,
      'That person is not in this workspace.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** A short reference for the register, derived from the uuid like the data requests' `DSR-` (the internal id never leaves the system). */
export const referenceOfHold = (uuid: string): string =>
  `LH-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** Does this hold cover the resolved person (their contacts, their leads, or the whole workspace)? */
function covers(hold: HoldRow, subject: ResolvedSubject): boolean {
  if (hold.scope === 'workspace') return true;
  if (hold.scope === 'contact')
    return hold.contactId !== null && subject.contactIds.includes(hold.contactId);
  return hold.leadId !== null && subject.leadIds.includes(hold.leadId);
}

function actorOf(): Actor {
  const ctx = RequestContextStore.peek();
  return {
    userId: ctx?.userId ?? null,
    actorType: ctx?.actorType ?? 'system',
    actorId: ctx?.actorId ?? null,
    requestId: ctx?.requestId ?? null,
  };
}

const systemActor = (): Actor => ({
  userId: null,
  actorType: 'system',
  actorId: null,
  requestId: null,
});

function auditSql(
  orgId: number,
  actor: Actor,
  recordId: number,
  action: string,
  delta: Record<string, { old: unknown; new: unknown }>,
) {
  return sql`
    INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
    VALUES (${orgId}, ${actor.actorId}, ${actor.actorType}, ${MODULE_KEY}, ${recordId}, ${action},
            ${JSON.stringify(delta)}::jsonb, ${actor.requestId})`;
}

function encodeCursor(r: HoldRow): string {
  return Buffer.from(`${r.placedAt.toISOString()}|${r.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { placedAt: Date; id: number } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const placedAt = new Date(at ?? '');
  const num = Number(id);
  if (Number.isNaN(placedAt.getTime()) || !Number.isInteger(num)) {
    throw AppError.validation('The cursor is not valid.', [{ path: 'cursor', message: 'invalid' }]);
  }
  return { placedAt, id: num };
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  ERROR_CODES,
  PRIVACY_DEFAULT_SLA_DAYS,
  PRIVACY_ERASE_PHRASE,
  PRIVACY_EXPORT_TYPES,
  type CreatePrivacyRequestInput,
  type ErasePrivacyRequestInput,
  type HoldPrivacyRequestInput,
  type ListPrivacyRequestsQuery,
  type PrivacyErasureReport,
  type PrivacyExport,
  type PrivacyRequest,
  type PrivacyRequestDetail,
  type PrivacyRequestList,
  type PrivacyRequestsSettings,
  type PrivacySubjectSearchResult,
  type RejectPrivacyRequestInput,
  type VerifyPrivacyRequestInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { ResolvedSubject } from '../registry/types';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ALL_TIERS, PersonalDataErasureService } from '../engine/erasure.service';
import { SubjectResolver } from '../engine/subject-resolver';
import { LegalHoldGuard, legalHoldActive } from '../legal-holds/legal-hold.guard';
import { LegalHoldsRepository } from '../legal-holds/legal-holds.repository';
import { ErasureExecutor, sameCounts } from './erasure-executor';
import { PrivacyExportPublisher } from './privacy-export.publisher';
import {
  maskSubject,
  referenceOf,
  toPrivacyEvent,
  toPrivacyExport,
  toPrivacyRequest,
} from './privacy-requests.mapper';
import { PrivacyRequestsRepository, type RequestRow } from './privacy-requests.repository';
import { storedSubjectOf } from './request-subject';

const MODULE_KEY = 'privacy_requests';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A preview older than this is not a basis for an irreversible action. */
const PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const stateError = (message: string, status = HttpStatus.CONFLICT) =>
  new AppError(ERROR_CODES.PRIVACY_REQUEST_STATE_INVALID, message, status);

/**
 * The rights service: a request about one person's data, its identity check, its clock, the export and the erasure. Every write is one
 * transaction with its event row, its audit row and its outbox event. No method logs or returns a personal value: a subject is shown
 * by a masked label, and the identifier of a person who is not a contact is stored sealed and removed when the request completes.
 */
@Injectable()
export class PrivacyRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PrivacyRequestsRepository,
    private readonly resolver: SubjectResolver,
    private readonly eraser: PersonalDataErasureService,
    private readonly publisher: PrivacyExportPublisher,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
    private readonly guard: LegalHoldGuard,
    private readonly holds: LegalHoldsRepository,
    private readonly executor: ErasureExecutor,
  ) {}

  // ---- create / read ----------------------------------------------------------------------------------------------------------

  async create(input: CreatePrivacyRequestInput): Promise<PrivacyRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let contactId: number | null = null;
      let leadId: number | null = null;
      let identifierKind: 'phone' | 'email' | null = null;
      let cipher: string | null = null;
      let label: string;
      const s = input.subject;
      if (s.kind === 'contact') {
        const c = await this.repo.contactByUuid(tx, ctx.orgId, s.id);
        if (!c) throw this.subjectNotFound();
        contactId = c.id;
        label = maskSubject(c);
      } else if (s.kind === 'lead') {
        const l = await this.repo.leadByUuid(tx, ctx.orgId, s.id);
        if (!l) throw this.subjectNotFound();
        leadId = l.id;
        label = maskSubject(l);
      } else {
        identifierKind = s.identifierKind;
        cipher = this.crypto.encrypt(s.value);
        label = maskSubject(s.identifierKind === 'phone' ? { phone: s.value } : { email: s.value });
      }
      const days = (await this.repo.slaDays(tx, ctx.orgId)) ?? PRIVACY_DEFAULT_SLA_DAYS;
      const row = await this.repo.insert(tx, ctx.orgId, {
        requestType: input.requestType,
        subjectKind: s.kind,
        contactId,
        leadId,
        identifierKind,
        identifierCipher: cipher,
        subjectLabel: label,
        requesterChannel: input.requesterChannel,
        internalNote: input.internalNote ?? null,
        dueAt: new Date(Date.now() + days * DAY_MS),
        historyMode: input.historyMode,
        createdBy: ctx.userId,
      });
      await this.repo.addEvent(tx, ctx.orgId, row.id, {
        type: 'created',
        to: 'received',
        actorUserId: ctx.userId,
        detail: {
          requestType: input.requestType,
          subjectKind: s.kind,
          channel: input.requesterChannel,
        },
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
      await this.emit(tx, row, 'privacy_request.created');
      // A request for a person who is already under a legal hold is restricted from the start (docs/specs/legal-hold.md section 4).
      if (input.requestType === 'erasure' && (contactId !== null || leadId !== null)) {
        const subject = await this.resolver.resolve(
          tx,
          ctx.orgId,
          contactId !== null ? { kind: 'contact', contactId } : { kind: 'lead', leadId: leadId! },
        );
        if (await this.guard.subjectHeld(tx, ctx.orgId, subject)) {
          const hold = await this.holds.coveringHold(tx, ctx.orgId, subject);
          await this.repo.restrict(tx, ctx.orgId, row.id, { holdId: hold?.id ?? null });
          await this.repo.addEvent(tx, ctx.orgId, row.id, {
            type: 'restricted',
            actorUserId: ctx.userId,
          });
          await this.emit(tx, row, 'privacy_request.restricted');
          return this.present(tx, ctx.orgId, (await this.repo.byId(tx, ctx.orgId, row.id))!);
        }
      }
      return this.present(tx, ctx.orgId, row);
    });
  }

  async list(query: ListPrivacyRequestsQuery): Promise<PrivacyRequestList> {
    const ctx = RequestContextStore.require();
    const after = decodeCursor(query.cursor);
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        status: query.status,
        requestType: query.requestType,
        overdue: query.overdue,
        restricted: query.restricted,
        limit: query.limit,
        after,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const now = new Date();
      const notice = page.some((r) => r.restrictedAt)
        ? await this.repo.holdNotice(tx, ctx.orgId)
        : null;
      return {
        data: page.map((r) => toPrivacyRequest(r, now, notice)),
        page: {
          nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
          hasMore: rows.length > query.limit,
          limit: query.limit,
        },
      };
    });
  }

  async get(uuid: string): Promise<PrivacyRequestDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid);
      const [events, exports] = await Promise.all([
        this.repo.events(tx, ctx.orgId, row.id),
        this.repo.exportsOf(tx, ctx.orgId, row.id),
      ]);
      const now = new Date();
      return {
        request: toPrivacyRequest(
          row,
          now,
          row.restrictedAt ? await this.repo.holdNotice(tx, ctx.orgId) : null,
        ),
        events: events.map(toPrivacyEvent),
        exports: exports.map((x) => toPrivacyExport(x, now)),
      };
    });
  }

  async searchSubjects(q: string): Promise<PrivacySubjectSearchResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const hits = await this.repo.searchSubjects(tx, ctx.orgId, q);
      return {
        data: hits.map((h) => ({
          kind: h.kind,
          id: h.uuid,
          name: h.name,
          hint: maskSubject({ phone: h.phone, email: h.email }),
        })),
      };
    });
  }

  // ---- identity, hold, reject, complete ---------------------------------------------------------------------------------------

  async verify(uuid: string, input: VerifyPrivacyRequestInput): Promise<PrivacyRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (row.status !== 'received' && row.status !== 'verifying') {
        throw stateError(
          'Identity can only be checked while the request is open and not yet verified.',
        );
      }
      if (input.outcome === 'verified' && !input.method) {
        throw AppError.validation('Say how the identity was verified.', [
          { path: 'method', message: 'required' },
        ]);
      }
      if (input.outcome === 'pending') {
        await this.repo.setStatus(tx, ctx.orgId, row.id, 'verifying');
        await this.repo.addEvent(tx, ctx.orgId, row.id, {
          type: 'verification_started',
          from: row.status,
          to: 'verifying',
          actorUserId: ctx.userId,
          detail: { method: input.method ?? null },
        });
      } else if (input.outcome === 'verified') {
        await this.repo.setStatus(tx, ctx.orgId, row.id, 'in_progress', {
          verification: {
            method: input.method!,
            evidenceRef: input.evidenceRef ?? null,
            by: ctx.userId,
          },
        });
        await this.repo.addEvent(tx, ctx.orgId, row.id, {
          type: 'verified',
          from: row.status,
          to: 'in_progress',
          actorUserId: ctx.userId,
          detail: { method: input.method, hasEvidenceRef: Boolean(input.evidenceRef) },
        });
      } else {
        await this.repo.setStatus(tx, ctx.orgId, row.id, 'rejected', {
          rejectionReason: 'Identity could not be verified.',
        });
        await this.repo.dropIdentifier(tx, ctx.orgId, row.id);
        await this.repo.addEvent(tx, ctx.orgId, row.id, {
          type: 'verification_failed',
          from: row.status,
          to: 'rejected',
          actorUserId: ctx.userId,
          detail: { method: input.method ?? null },
        });
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: nextStatus(input.outcome) } },
      });
      const after = (await this.repo.byId(tx, ctx.orgId, row.id))!;
      await this.emit(tx, after, 'privacy_request.verification_changed', {
        outcome: input.outcome,
      });
      return this.present(tx, ctx.orgId, after);
    });
  }

  async hold(uuid: string, input: HoldPrivacyRequestInput): Promise<PrivacyRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (!['received', 'verifying', 'in_progress'].includes(row.status)) {
        throw stateError('A closed request cannot be put on or taken off legal hold.');
      }
      await this.repo.setHold(
        tx,
        ctx.orgId,
        row.id,
        input.held,
        input.held ? input.reason : null,
        ctx.userId,
      );
      await this.repo.addEvent(tx, ctx.orgId, row.id, {
        type: input.held ? 'hold_set' : 'hold_released',
        actorUserId: ctx.userId,
        // The reason is the admin's own sentence about a legal duty; it stays on the request, not in the event.
        detail: {},
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { legalHold: { old: row.legalHold, new: input.held } },
      });
      const after = (await this.repo.byId(tx, ctx.orgId, row.id))!;
      await this.emit(tx, after, 'privacy_request.hold_changed', { held: input.held });
      return this.present(tx, ctx.orgId, after);
    });
  }

  async reject(uuid: string, input: RejectPrivacyRequestInput): Promise<PrivacyRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (!['received', 'verifying', 'in_progress'].includes(row.status)) {
        throw stateError('A closed request cannot be rejected.');
      }
      await this.repo.setStatus(tx, ctx.orgId, row.id, 'rejected', {
        rejectionReason: input.reason,
      });
      await this.repo.dropIdentifier(tx, ctx.orgId, row.id);
      await this.repo.addEvent(tx, ctx.orgId, row.id, {
        type: 'rejected',
        from: row.status,
        to: 'rejected',
        actorUserId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: 'rejected' } },
      });
      const after = (await this.repo.byId(tx, ctx.orgId, row.id))!;
      await this.emit(tx, after, 'privacy_request.rejected');
      return this.present(tx, ctx.orgId, after);
    });
  }

  /** Closes a request that ends without a file or an erasure (rectification, restriction, objection, withdrawal), or an export that was delivered. */
  async complete(uuid: string): Promise<PrivacyRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (row.status !== 'in_progress') {
        throw new AppError(
          row.status === 'received' || row.status === 'verifying'
            ? ERROR_CODES.PRIVACY_IDENTITY_NOT_VERIFIED
            : ERROR_CODES.PRIVACY_REQUEST_STATE_INVALID,
          row.status === 'received' || row.status === 'verifying'
            ? 'Verify the identity first.'
            : 'The request is already closed.',
          HttpStatus.CONFLICT,
        );
      }
      if (row.requestType === 'erasure') {
        throw stateError('An erasure is completed by executing it.');
      }
      await this.close(tx, ctx.orgId, row, ctx.userId, 'completed_manually');
      const after = (await this.repo.byId(tx, ctx.orgId, row.id))!;
      return this.present(tx, ctx.orgId, after);
    });
  }

  // ---- export -----------------------------------------------------------------------------------------------------------------

  async requestExport(uuid: string): Promise<PrivacyExport> {
    const ctx = RequestContextStore.require();
    const created = await this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      this.assertVerified(row);
      if (row.requestType === 'erasure' && row.status !== 'in_progress') {
        throw stateError('The request is closed.');
      }
      if (storedSubjectOf(row, this.crypto) === null) {
        throw new AppError(
          ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND,
          'The person is no longer in the workspace: there is nothing left to export.',
          HttpStatus.CONFLICT,
        );
      }
      if (await this.repo.activeExport(tx, ctx.orgId, row.id)) {
        throw new AppError(
          ERROR_CODES.PRIVACY_EXPORT_IN_PROGRESS,
          'An export of this request is already being prepared.',
          HttpStatus.CONFLICT,
        );
      }
      const x = await this.repo.createExport(tx, ctx.orgId, row.id, ctx.userId);
      await this.repo.addEvent(tx, ctx.orgId, row.id, {
        type: 'export_requested',
        actorUserId: ctx.userId,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'export' });
      await this.emit(tx, row, 'privacy_request.export_requested');
      return x;
    });

    try {
      await this.publisher.enqueue(ctx.orgId, created.uuid);
    } catch (err) {
      // Redis is down: the row must not sit `queued` forever, blocking every later request.
      await this.db.tx((tx) =>
        this.repo.failExport(
          tx,
          ctx.orgId,
          created.id,
          'The export could not be started. Try again.',
        ),
      );
      throw err;
    }
    return toPrivacyExport(created);
  }

  async downloadExport(
    uuid: string,
    exportUuid: string,
  ): Promise<{ stream: Readable; fileName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, true);
      const x = await this.repo.exportByUuid(tx, ctx.orgId, exportUuid);
      if (!x || x.requestId !== row.id) {
        throw new AppError(
          ERROR_CODES.PRIVACY_EXPORT_NOT_FOUND,
          'Export not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const file = await this.repo.exportFile(tx, ctx.orgId, x.id);
      if (!file) {
        throw new AppError(
          ERROR_CODES.PRIVACY_EXPORT_NOT_READY,
          x.status === 'expired' || (x.expiresAt && x.expiresAt.getTime() <= Date.now())
            ? 'This export has expired. Request it again.'
            : 'This export is not ready yet.',
          HttpStatus.CONFLICT,
        );
      }
      // The file of a person's data leaves the system: audited each time, and the request is delivered on the first download.
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'export' });
      await this.repo.addEvent(tx, ctx.orgId, row.id, {
        type: 'export_downloaded',
        actorUserId: ctx.userId,
        detail: { bytes: file.length },
      });
      if (
        row.status === 'in_progress' &&
        (PRIVACY_EXPORT_TYPES as readonly string[]).includes(row.requestType)
      ) {
        await this.close(tx, ctx.orgId, row, ctx.userId, 'export_delivered');
      }
      return { file, name: x.fileName ?? `${referenceOf(row.uuid)}-data-export.zip` };
    });
    return { stream: Readable.from(found.file), fileName: found.name };
  }

  // ---- erasure ----------------------------------------------------------------------------------------------------------------

  async erase(uuid: string, input: ErasePrivacyRequestInput): Promise<PrivacyErasureReport> {
    const ctx = RequestContextStore.require();
    const outcome = await this.db.tx(
      async (tx): Promise<PrivacyErasureReport | { restricted: true }> => {
        const row = await this.mustFind(tx, ctx.orgId, uuid, true);
        this.assertErasable(row);
        const stored = storedSubjectOf(row, this.crypto);
        if (!stored) {
          throw new AppError(
            ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND,
            'The person is no longer in the workspace.',
            HttpStatus.CONFLICT,
          );
        }
        const subject = await this.resolver.resolve(tx, ctx.orgId, stored);
        const mode = row.historyMode === 'anonymise' ? 'anonymise' : 'delete';
        const base = {
          orgId: ctx.orgId,
          requestId: row.id,
          subject,
          tiers: ALL_TIERS,
          mode,
        } as const;

        if (input.dryRun) {
          const preview = await this.eraser.run(tx, { ...base, dryRun: true });
          await this.repo.saveDryRun(tx, ctx.orgId, row.id, preview.report);
          await this.repo.addEvent(tx, ctx.orgId, row.id, {
            type: 'erase_previewed',
            actorUserId: ctx.userId,
            detail: { ...preview.report.totals, files: preview.report.files },
          });
          await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'read' });
          return preview.report;
        }

        // ---- execute -----------------------------------------------------------------------------------------------------------
        const stale =
          !row.dryRunSummary ||
          !row.dryRunAt ||
          Date.now() - row.dryRunAt.getTime() > PREVIEW_MAX_AGE_MS;
        if (stale) {
          throw new AppError(
            ERROR_CODES.PRIVACY_CONFIRMATION_REQUIRED,
            'Preview the erasure first (the preview is valid for 24 hours).',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const phrase = `${PRIVACY_ERASE_PHRASE} ${referenceOf(row.uuid)}`;
        if ((input.confirmation ?? '').trim() !== phrase) {
          throw new AppError(
            ERROR_CODES.PRIVACY_CONFIRMATION_REQUIRED,
            `Type "${phrase}" to confirm.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // A legal hold (BL-295, docs/specs/legal-hold.md section 4): the person confirmed, but the data must be kept. Nothing is erased; the
        // case becomes "restricted", the confirmation is kept so the worker can execute it when the hold ends, and the caller is told
        // 409 after this transaction has committed (an error thrown here would roll the restriction back with it).
        if (await this.guard.subjectHeld(tx, ctx.orgId, subject)) {
          await this.restrictAfterAttempt(tx, ctx.orgId, ctx.userId, row, subject);
          return { restricted: true };
        }

        // What the person confirmed is what runs: the counts are taken again inside this transaction and must equal the preview.
        const again = await this.eraser.run(tx, { ...base, dryRun: true });
        if (!sameCounts(again.report, row.dryRunSummary!)) {
          throw stateError(
            'The data changed since the preview. Preview the erasure again before executing it.',
          );
        }
        return this.executor.execute(tx, {
          orgId: ctx.orgId,
          row,
          subject,
          mode,
          actorUserId: ctx.userId,
          previewed: row.dryRunSummary!,
          resumedAfterHold: false,
        });
      },
    );
    if ('restricted' in outcome) {
      throw legalHoldActive(1, true);
    }
    return outcome;
  }

  /**
   * Records that someone tried to execute this erasure while the person is held: the case is restricted (if it was not already), the
   * confirmation is kept, and the event and audit row are written. No data changes.
   */
  private async restrictAfterAttempt(
    tx: Tx,
    orgId: number,
    userId: number | null,
    row: RequestRow,
    subject: ResolvedSubject,
  ): Promise<void> {
    const hold = await this.holds.coveringHold(tx, orgId, subject);
    const alreadyRestricted = row.restrictedAt !== null;
    await this.repo.restrict(tx, orgId, row.id, {
      holdId: hold?.id ?? null,
      confirmedBy: userId,
    });
    await this.repo.addEvent(tx, orgId, row.id, {
      type: alreadyRestricted ? 'erasure_queued' : 'restricted',
      actorUserId: userId,
      detail: { confirmed: true },
    });
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: row.id,
      action: 'update',
      delta: { restricted: { old: alreadyRestricted, new: true } },
    });
    if (!alreadyRestricted) await this.emit(tx, row, 'privacy_request.restricted');
  }

  // ---- settings ---------------------------------------------------------------------------------------------------------------

  async getSettings(): Promise<PrivacyRequestsSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      slaDays: (await this.repo.slaDays(tx, ctx.orgId)) ?? PRIVACY_DEFAULT_SLA_DAYS,
      legalHoldRequesterNotice: await this.repo.holdNotice(tx, ctx.orgId),
    }));
  }

  async updateSettings(input: PrivacyRequestsSettings): Promise<PrivacyRequestsSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.repo.saveSla(tx, ctx.orgId, input.slaDays, ctx.userId);
      const delta: Record<string, { old: unknown; new: unknown }> = {
        slaDays: { old: null, new: input.slaDays },
      };
      if (input.legalHoldRequesterNotice !== undefined) {
        await this.repo.saveHoldNotice(
          tx,
          ctx.orgId,
          input.legalHoldRequesterNotice || null,
          ctx.userId,
        );
        // The wording is counsel's text, not a personal value; the audit row only says that it changed.
        delta.legalHoldRequesterNotice = {
          old: null,
          new: input.legalHoldRequesterNotice ? 'set' : 'cleared',
        };
      }
      await this.audit.record(tx, {
        module: 'privacy_settings',
        recordId: ctx.orgId,
        action: 'update',
        delta,
      });
      return {
        slaDays: input.slaDays,
        legalHoldRequesterNotice: await this.repo.holdNotice(tx, ctx.orgId),
      };
    });
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------------------

  /** The wire shape of a case; a restricted one carries the workspace's own requester wording when it set one. */
  private async present(tx: Tx, orgId: number, row: RequestRow): Promise<PrivacyRequest> {
    const notice = row.restrictedAt ? await this.repo.holdNotice(tx, orgId) : null;
    return toPrivacyRequest(row, new Date(), notice);
  }

  private async mustFind(tx: Tx, orgId: number, uuid: string, lock = false): Promise<RequestRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid, { lock });
    if (!row) {
      throw new AppError(
        ERROR_CODES.PRIVACY_REQUEST_NOT_FOUND,
        'Data request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private subjectNotFound(): AppError {
    return new AppError(
      ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND,
      'That person is not in this workspace.',
      HttpStatus.NOT_FOUND,
    );
  }

  private assertVerified(row: RequestRow): void {
    if (row.status === 'received' || row.status === 'verifying') {
      throw new AppError(
        ERROR_CODES.PRIVACY_IDENTITY_NOT_VERIFIED,
        'Verify the identity of the person before using their data.',
        HttpStatus.CONFLICT,
      );
    }
    if (row.status !== 'in_progress') throw stateError('The request is closed.');
  }

  private assertErasable(row: RequestRow): void {
    if (row.requestType !== 'erasure') {
      throw stateError('Only an erasure request can erase data.');
    }
    this.assertVerified(row);
    if (row.legalHold) {
      throw new AppError(
        ERROR_CODES.PRIVACY_LEGAL_HOLD,
        'This request is on legal hold. Release the hold before erasing.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async close(
    tx: Tx,
    orgId: number,
    row: RequestRow,
    userId: number | null,
    how: string,
  ): Promise<void> {
    await this.repo.setStatus(tx, orgId, row.id, 'completed', { completed: true });
    await this.repo.dropIdentifier(tx, orgId, row.id);
    await this.repo.addEvent(tx, orgId, row.id, {
      type: 'completed',
      from: row.status,
      to: 'completed',
      actorUserId: userId,
      detail: { how },
    });
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: row.id,
      action: 'update',
      delta: { status: { old: row.status, new: 'completed' } },
    });
    const after = (await this.repo.byId(tx, orgId, row.id))!;
    await this.emit(tx, after, 'privacy_request.completed', { how });
  }

  private emit(
    tx: Tx,
    row: RequestRow,
    eventType: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      // Identifiers and the type only: the event never carries the person.
      payload: {
        uuid: row.uuid,
        reference: referenceOf(row.uuid),
        requestType: row.requestType,
        ...extra,
      },
    });
  }
}

const nextStatus = (o: VerifyPrivacyRequestInput['outcome']): string =>
  o === 'pending' ? 'verifying' : o === 'verified' ? 'in_progress' : 'rejected';

function encodeCursor(r: RequestRow): string {
  return Buffer.from(`${r.receivedAt.toISOString()}|${r.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { receivedAt: Date; id: number } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const receivedAt = new Date(at ?? '');
  const num = Number(id);
  if (Number.isNaN(receivedAt.getTime()) || !Number.isInteger(num)) {
    throw AppError.validation('The cursor is not valid.', [{ path: 'cursor', message: 'invalid' }]);
  }
  return { receivedAt, id: num };
}

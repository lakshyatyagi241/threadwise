import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CONSENT_EXPORT_SYNC_MAX,
  ERROR_CODES,
  type ConsentExport,
  type ConsentExportList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ConsentExportPublisher } from './consent-export.publisher';
import { ConsentExportRepository, type ConsentExportRow } from './consent-export.repository';

const LIST_LIMIT = 20;

/**
 * The asynchronous export of the consent proof, API side: records the request, enqueues it and serves the list and the finished file.
 * The build is the worker's (`ConsentExportRunner`). The direct CSV (`GET /export`) stays for ledgers up to CONSENT_EXPORT_SYNC_MAX rows.
 */
@Injectable()
export class ConsentExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentExportRepository,
    private readonly publisher: ConsentExportPublisher,
    private readonly audit: AuditService,
  ) {}

  async request(): Promise<ConsentExport> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden('contacts.consent.manage');
    const userId = ctx.userId;

    const created = await this.db.tx(async (tx) => {
      if (await this.repo.active(tx, ctx.orgId)) {
        throw new AppError(
          ERROR_CODES.CONSENT_EXPORT_IN_PROGRESS,
          'An export is already being prepared. Wait for its email, then request another.',
          HttpStatus.CONFLICT,
        );
      }
      const who = await this.repo.userContact(tx, ctx.orgId, userId);
      const row = await this.repo.create(tx, ctx.orgId, {
        requestedBy: userId,
        emailedTo: who?.email ?? null,
      });
      // The proof of every contact's consent leaves the system: it is audited when it is asked for.
      await this.audit.record(tx, {
        module: 'contact_consent_exports',
        recordId: row.id,
        action: 'insert',
      });
      return row;
    });

    try {
      await this.publisher.enqueue(ctx.orgId, created.uuid);
    } catch (err) {
      // Redis is down: the row must not sit `queued` forever, blocking every later request.
      await this.db.tx((tx) =>
        this.repo.fail(tx, ctx.orgId, created.id, 'The export could not be started. Try again.'),
      );
      throw err;
    }
    return toConsentExport(created);
  }

  async list(): Promise<ConsentExportList> {
    const ctx = RequestContextStore.require();
    const { rows, ledgerRows } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, ctx.orgId, LIST_LIMIT),
      ledgerRows: await this.repo.ledgerRowsUpTo(tx, ctx.orgId, CONSENT_EXPORT_SYNC_MAX + 1),
    }));
    return {
      data: rows.map(toConsentExport),
      ledgerRows,
      needsAsync: ledgerRows > CONSENT_EXPORT_SYNC_MAX,
    };
  }

  async download(exportUuid: string): Promise<{ stream: Readable; fileName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, exportUuid);
      if (!row) return { row: null, file: null };
      return { row, file: await this.repo.file(tx, ctx.orgId, row.id) };
    });
    if (!found.row) {
      throw new AppError(
        ERROR_CODES.CONSENT_EXPORT_NOT_FOUND,
        'Export not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!found.file) {
      throw new AppError(
        ERROR_CODES.CONSENT_EXPORT_NOT_READY,
        found.row.status === 'expired' ||
          (found.row.status === 'ready' && (found.row.expiresAt?.getTime() ?? 0) <= Date.now())
          ? 'This export has expired. Request it again.'
          : 'This export is not ready yet.',
        HttpStatus.CONFLICT,
      );
    }
    return {
      stream: Readable.from(found.file).pipe(createGunzip()),
      fileName: found.row.fileName ?? 'consent-proof.csv',
    };
  }
}

export function toConsentExport(r: ConsentExportRow): ConsentExport {
  return {
    id: r.uuid,
    status: r.status,
    rowCount: r.rowCount,
    fileBytes: r.fileBytes,
    error: r.error,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    emailedTo: r.emailedTo,
  };
}

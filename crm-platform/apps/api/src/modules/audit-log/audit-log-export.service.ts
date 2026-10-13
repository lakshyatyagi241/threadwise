import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG_EXPORT_MODULE,
  ERROR_CODES,
  type AuditLogExport,
  type AuditLogExportList,
  type RequestAuditLogExport,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { AuditLogExportPublisher } from './audit-log-export.publisher';
import { AuditLogRepository, type ExportRow } from './audit-log.repository';
import { resolveWindow } from './audit-log.rules';

const LIST_LIMIT = 20;

/**
 * The asynchronous export of the audit log, API side: records the request (the window is fixed now), enqueues it and serves the list
 * and the finished file. The build is the worker's (`AuditLogExportRunner`). Asking for an export is itself audited.
 */
@Injectable()
export class AuditLogExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuditLogRepository,
    private readonly publisher: AuditLogExportPublisher,
    private readonly audit: AuditService,
  ) {}

  async request(filters: RequestAuditLogExport): Promise<AuditLogExport> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden('audit.log.export');
    const userId = ctx.userId;
    // The window is resolved now, so "the last 30 days" means the 30 days before the click, not before the worker got to it.
    const window = resolveWindow(filters);
    const fixed: RequestAuditLogExport = {
      ...filters,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };

    const created = await this.db.tx(async (tx) => {
      if (await this.repo.activeExport(tx, ctx.orgId)) {
        throw new AppError(
          ERROR_CODES.AUDIT_EXPORT_IN_PROGRESS,
          'An export is already being prepared. Wait for its email, then request another.',
          HttpStatus.CONFLICT,
        );
      }
      const who = await this.repo.userContact(tx, ctx.orgId, userId);
      const row = await this.repo.createExport(tx, ctx.orgId, {
        requestedBy: userId,
        emailedTo: who?.email ?? null,
        filters: fixed,
      });
      await this.audit.record(tx, {
        module: AUDIT_LOG_EXPORT_MODULE,
        recordId: row.id,
        action: 'export',
        delta: { filters: { old: null, new: fixed } },
      });
      return row;
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
    return toAuditLogExport(created);
  }

  async list(): Promise<AuditLogExportList> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.listExports(tx, ctx.orgId, LIST_LIMIT));
    return { data: rows.map(toAuditLogExport) };
  }

  async download(exportUuid: string): Promise<{ stream: Readable; fileName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const row = await this.repo.exportByUuid(tx, ctx.orgId, exportUuid);
      if (!row) return { row: null, file: null };
      return { row, file: await this.repo.exportFile(tx, ctx.orgId, row.id) };
    });
    if (!found.row) {
      throw new AppError(
        ERROR_CODES.AUDIT_EXPORT_NOT_FOUND,
        'Export not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!found.file) {
      throw new AppError(
        ERROR_CODES.AUDIT_EXPORT_NOT_READY,
        found.row.status === 'expired' ||
          (found.row.status === 'ready' && (found.row.expiresAt?.getTime() ?? 0) <= Date.now())
          ? 'This export has expired. Request it again.'
          : 'This export is not ready yet.',
        HttpStatus.CONFLICT,
      );
    }
    return {
      stream: Readable.from(found.file.file).pipe(createGunzip()),
      fileName: found.file.fileName,
    };
  }
}

export function toAuditLogExport(r: ExportRow): AuditLogExport {
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
    filters: r.filters,
  };
}

import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  REVENUE_EXPORT_MODULE,
  REVENUE_PERMISSIONS,
  type RecordScope,
  type RequestRevenueExport,
  type RevenueExport,
  type RevenueExportFilters,
  type RevenueExportList,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { RevenueExportPublisher } from './revenue-export.publisher';
import { RevenueExportRepository, type RevenueExportRow } from './revenue-export.repository';
import { RevenueReportService } from './revenue-report.service';

const LIST_LIMIT = 20;

/**
 * The files of the revenue report, API side: records the request (the period and its comparison are fixed to dates now, and so is the
 * record scope the person's `record.payments.read` grant gives), enqueues it, and serves the list and the finished file. The build is
 * the worker's (`RevenueExportRunner`). Asking for a file is itself audited. A person sees and downloads only their own files.
 */
@Injectable()
export class RevenueExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly exports: RevenueExportRepository,
    private readonly reports: RevenueReportService,
    private readonly publisher: RevenueExportPublisher,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async request(body: RequestRevenueExport): Promise<RevenueExport> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden(REVENUE_PERMISSIONS.export);
    const userId = ctx.userId;
    // A file is a copy of the report, so it can never hold more than the report shows this person.
    const read = ctx.grants
      ? this.rbac.can(ctx.grants, REVENUE_PERMISSIONS.read)
      : { allowed: false, scope: 'own' as RecordScope };
    if (!read.allowed) throw AppError.forbidden(REVENUE_PERMISSIONS.read);
    const { format, csvKind, ...query } = body;

    const created = await this.db.tx(async (tx) => {
      // Validates the owner and the team, and fixes the dates ("this month" is the month of the click, not of the worker's turn).
      const { period, tz } = await this.reports.resolve(tx, {
        orgId: ctx.orgId,
        userId,
        scope: read.scope,
        query,
      });
      if (await this.exports.active(tx, ctx.orgId, userId)) {
        throw new AppError(
          ERROR_CODES.REVENUE_EXPORT_IN_PROGRESS,
          'A file is already being prepared for you. Wait for its email, then request another.',
          HttpStatus.CONFLICT,
        );
      }
      const filters: RevenueExportFilters = {
        range: period.range,
        fromDate: period.fromDate,
        toDate: period.toDate,
        timezone: tz,
        compare: period.compare
          ? {
              mode: period.compare.mode,
              fromDate: period.compare.fromDate,
              toDate: period.compare.toDate,
            }
          : null,
        groupBy: query.groupBy,
        ownerId: query.ownerId ?? null,
        teamId: query.teamId ?? null,
        currency: query.currency ?? null,
        convertTo: query.convertTo ?? null,
      };
      const who = await this.exports.userContact(tx, ctx.orgId, userId);
      const row = await this.exports.create(tx, ctx.orgId, {
        requestedBy: userId,
        emailedTo: who?.email ?? null,
        format,
        csvKind: format === 'csv' ? csvKind : null,
        scope: read.scope,
        filters,
      });
      await this.audit.record(tx, {
        module: REVENUE_EXPORT_MODULE,
        recordId: row.id,
        action: 'export',
        delta: {
          format: { old: null, new: format },
          filters: { old: null, new: filters },
        },
      });
      return row;
    });

    try {
      await this.publisher.enqueue(ctx.orgId, created.uuid);
    } catch (err) {
      // Redis is down: the row must not sit `queued` forever, blocking every later request.
      await this.db.tx((tx) =>
        this.exports.fail(tx, ctx.orgId, created.id, 'The export could not be started. Try again.'),
      );
      throw err;
    }
    return toRevenueExport(created);
  }

  async list(): Promise<RevenueExportList> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) return { data: [] };
    const userId = ctx.userId;
    const rows = await this.db.tx((tx) => this.exports.list(tx, ctx.orgId, userId, LIST_LIMIT));
    return { data: rows.map(toRevenueExport) };
  }

  async download(
    exportUuid: string,
  ): Promise<{ stream: Readable; fileName: string; contentType: string }> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId;
    const found = await this.db.tx(async (tx) => {
      const row =
        userId === null ? null : await this.exports.byUuid(tx, ctx.orgId, exportUuid, userId);
      if (!row) return { row: null, file: null };
      return { row, file: await this.exports.file(tx, ctx.orgId, row.id) };
    });
    if (!found.row) {
      throw new AppError(
        ERROR_CODES.REVENUE_EXPORT_NOT_FOUND,
        'Export not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!found.file) {
      throw new AppError(
        ERROR_CODES.REVENUE_EXPORT_NOT_READY,
        found.row.status === 'expired' ||
          (found.row.status === 'ready' && (found.row.expiresAt?.getTime() ?? 0) <= Date.now())
          ? 'This file has expired. Request it again.'
          : 'This file is not ready yet.',
        HttpStatus.CONFLICT,
      );
    }
    return {
      stream: Readable.from(found.file.file).pipe(createGunzip()),
      fileName: found.file.fileName,
      contentType: found.row.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
    };
  }
}

export function toRevenueExport(r: RevenueExportRow): RevenueExport {
  return {
    id: r.uuid,
    format: r.format,
    csvKind: r.csvKind,
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

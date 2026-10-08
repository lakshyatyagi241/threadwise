import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  REPORT_DOCUMENT_LIMITS,
  type ReportDocument,
  type ReportDocumentListResponse,
  type ReportScope,
  type UploadReportDocumentFields,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { extractFileText } from '../ai-agents-training';
import { AuthAuditService, PlatformStore } from '../auth';
import { toReportDocument } from './report-documents.mapper';
import {
  ReportDocumentsRepository,
  type ReportDocumentFull,
  type ReportDocumentRow,
} from './report-documents.repository';
import {
  docLimitReached,
  docNoText,
  docTooLarge,
  docTypeUnsupported,
  docUnreadable,
} from './report-errors';
import { displayName, extensionOf, isReadableExtension, prepareText } from './report-rules';

const MODULE_KEY = 'report_documents';

/** The shape multer hands over (memory storage). */
export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** What the server says a file is, by its extension: the client's own content type is never stored. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
};

/** multer reads the multipart file name as Latin-1; a UTF-8 name arrives as mojibake. Re-decode when that round-trips cleanly. */
function decodeFileName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/**
 * The document libraries of the AI report assistant: a workspace's (`report_documents`, its tenant) and the operator's
 * (`platform_report_documents`, through the platform door). One class, because both follow the same rules: an allowed type, up to 10 MB,
 * 25 documents, text read while the request waits and cut at 400 000 characters.
 *
 * A file that cannot be read or holds no text is refused with a problem and nothing is stored, so a bad file never takes one of the 25
 * places. The original file is not kept, only its text.
 */
@Injectable()
export class ReportDocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly platform: PlatformStore,
    private readonly repo: ReportDocumentsRepository,
    private readonly audit: AuditService,
    private readonly authAudit: AuthAuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Runs `fn` in the right transaction: the caller's tenant for a workspace, the platform door for the operator. */
  private run<T>(scope: ReportScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return scope === 'workspace' ? this.db.tx(fn) : this.platform.tx(fn);
  }

  /** The tenant id (0 on the platform, which has none) and who is acting. */
  private who(scope: ReportScope): { orgId: number; actorId: number | null } {
    const ctx = RequestContextStore.require();
    return scope === 'workspace'
      ? { orgId: ctx.orgId, actorId: ctx.userId }
      : { orgId: 0, actorId: ctx.actorId };
  }

  async list(scope: ReportScope): Promise<ReportDocumentListResponse> {
    const { orgId } = this.who(scope);
    const rows = await this.run(scope, (tx) =>
      this.repo.list(tx, scope, orgId, REPORT_DOCUMENT_LIMITS.maxDocuments),
    );
    return { data: rows.map(toReportDocument), limit: REPORT_DOCUMENT_LIMITS.maxDocuments };
  }

  async upload(
    scope: ReportScope,
    file: UploadedFile | undefined,
    fields: UploadReportDocumentFields,
  ): Promise<ReportDocument> {
    const { orgId, actorId } = this.who(scope);
    if (!file || file.size === 0) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'file', message: 'Pick a file (PDF, DOCX, TXT, Markdown, CSV, HTML or JSON).' },
      ]);
    }
    const fileName = decodeFileName(file.originalname);
    const ext = extensionOf(fileName);
    if (!isReadableExtension(ext)) throw docTypeUnsupported(ext);
    if (file.size > REPORT_DOCUMENT_LIMITS.fileBytes) throw docTooLarge();

    // Refused before any bytes are parsed: reading a PDF is the expensive part, and a full library cannot take the result anyway.
    if ((await this.run(scope, (tx) => this.repo.count(tx, scope, orgId))) >= this.max()) {
      throw docLimitReached();
    }

    let raw: string;
    try {
      raw = await extractFileText(file.buffer, ext);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.AIAG_FILE_UNREADABLE) {
        throw docUnreadable();
      }
      throw err;
    }
    const { text, truncated } = prepareText(raw);
    if (text === '') throw docNoText();

    const name = displayName(fileName, fields.name);
    const created = await this.run(scope, async (tx) => {
      // Checked again under the library lock: two uploads at 24 of 25 must not both get in.
      await this.repo.lockLibrary(tx, scope, orgId);
      if ((await this.repo.count(tx, scope, orgId)) >= this.max()) throw docLimitReached();
      const row = await this.repo.insert(tx, scope, orgId, {
        name,
        extension: ext,
        mime: MIME_BY_EXT[ext] ?? null,
        sizeBytes: file.size,
        charCount: text.length,
        truncated,
        extractedText: text,
        createdBy: actorId,
      });
      await this.record(tx, scope, row, 'insert', 'report_document.created');
      return row;
    });
    return toReportDocument(created);
  }

  async remove(scope: ReportScope, uuid: string): Promise<void> {
    const { orgId } = this.who(scope);
    await this.run(scope, async (tx) => {
      const current = await this.repo.findByUuid(tx, scope, orgId, uuid);
      if (!current) throw AppError.notFound('Document', uuid);
      await this.repo.delete(tx, scope, orgId, current.id);
      await this.record(tx, scope, current, 'delete', 'report_document.deleted');
    });
  }

  // --- what the assistant's tools read ---------------------------------------------------------------------------------------------------

  /** The ready documents of the caller's library, newest first. */
  async listReady(scope: ReportScope): Promise<ReportDocumentRow[]> {
    const { orgId } = this.who(scope);
    const rows = await this.run(scope, (tx) =>
      this.repo.list(tx, scope, orgId, REPORT_DOCUMENT_LIMITS.maxDocuments),
    );
    return rows.filter((r) => r.status === 'ready');
  }

  /** One document with its text, from the caller's own library only; undefined for an id that is not in it. */
  async readFull(scope: ReportScope, uuid: string): Promise<ReportDocumentFull | undefined> {
    const { orgId } = this.who(scope);
    const row = await this.run(scope, (tx) => this.repo.findFullByUuid(tx, scope, orgId, uuid));
    return row && row.status === 'ready' ? row : undefined;
  }

  private max(): number {
    return REPORT_DOCUMENT_LIMITS.maxDocuments;
  }

  /** Audit and outbox (workspace) or the platform security stream (operator), in the write's own transaction. */
  private async record(
    tx: Tx,
    scope: ReportScope,
    row: ReportDocumentRow,
    action: 'insert' | 'delete',
    eventType: string,
  ): Promise<void> {
    if (scope === 'workspace') {
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action,
        delta: {
          name: {
            old: action === 'insert' ? null : row.name,
            new: action === 'insert' ? row.name : null,
          },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType,
        payload: { uuid: row.uuid, extension: row.extension, charCount: row.charCount },
      });
      return;
    }
    // The operator has no workspace to hang an outbox event on; the platform's security stream is its audit trail.
    await this.authAudit.record(tx, {
      event: `platform.${eventType}`,
      status: 'info',
      actorType: 'platform_operator',
      actorId: RequestContextStore.require().actorId,
      payload: { document: row.uuid, name: row.name, extension: row.extension },
    });
  }
}

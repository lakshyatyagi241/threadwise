import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  SAVED_REPLY_IMPORT_MAX_BYTES,
  SAVED_REPLY_IMPORT_MAX_ROWS,
  SAVED_REPLY_IMPORT_ROWS_SHOWN,
  savedReplyImportOptionsSchema,
  type SavedReplyImportOptions,
  type SavedReplyImportResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { parseCsv } from '../../crm';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { SavedRepliesRepository } from './saved-replies.repository';
import {
  columnIndexes,
  parseRow,
  savedRepliesCsv,
  type ImportCandidate,
  type RowParse,
} from './saved-replies-csv';

const MODULE_KEY = 'saved_replies';
/** An export carries at most this many shared replies (far above any plan; a sanity ceiling). */
const EXPORT_MAX = 20_000;

export interface UploadedFile {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}

const invalidFile = (message: string): AppError =>
  new AppError(ERROR_CODES.SAVED_REPLY_IMPORT_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY);

/** The upload as text: size, type and encoding checked once (UTF-8, falling back to Windows-1252 as spreadsheets save it). */
export function decodeRepliesUpload(file: UploadedFile | undefined): string {
  if (!file?.buffer) throw invalidFile('Choose a CSV file to upload.');
  if (file.buffer.length > SAVED_REPLY_IMPORT_MAX_BYTES) {
    throw invalidFile(`The file is larger than ${SAVED_REPLY_IMPORT_MAX_BYTES / 1024} KB.`);
  }
  if (!/\.(csv|txt)$/i.test(file.originalname) && !/csv|text\/plain/i.test(file.mimetype ?? '')) {
    throw invalidFile('Upload a .csv or .txt file.');
  }
  if (file.buffer.includes(0))
    throw invalidFile('This is not a text CSV file. Export it as CSV first.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(file.buffer);
  }
}

/** Parses the options field of the multipart form (a JSON string). */
export function parseImportOptions(raw: unknown): SavedReplyImportOptions {
  let value: unknown = {};
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw AppError.validation('options must be a JSON object');
    }
  }
  const parsed = savedReplyImportOptionsSchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.validation(
      'Invalid import options',
      parsed.error.issues.map((i) => ({ path: `options.${i.path.join('.')}`, message: i.message })),
    );
  }
  return parsed.data;
}

/**
 * Import and export of the shared library as CSV (title, shortcut, body, category, language, channel).
 *
 * Export: shared replies only (a personal reply is its owner's), every text cell formula-safe. Import: always creates or updates SHARED
 * replies (the caller holds `inbox.savedreply.manage`); each row is checked on its own and reported, a bad row never stops the others;
 * a shortcut a shared reply already uses is skipped or overwritten as the person chose; the plan's `saved_replies` cap counts every reply
 * of the workspace and the rows past it are reported `plan_limit_reached`. With `dryRun` nothing is written. A real import is ONE
 * transaction with an audit row and an outbox event per reply, like the single create and update.
 */
@Injectable()
export class SavedRepliesTransferService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SavedRepliesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async exportCsv(): Promise<string> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.listShared(tx, ctx.orgId, EXPORT_MAX));
    return savedRepliesCsv(
      rows.map((r) => ({
        title: r.title as string,
        shortcut: r.shortcut as string,
        body: r.body as string,
        category: (r.category as string | null) ?? null,
        language: (r.language as string | null) ?? null,
        channelKinds: (r.channel_kinds as string[]) ?? [],
      })),
    );
  }

  async import(
    file: UploadedFile | undefined,
    options: SavedReplyImportOptions,
  ): Promise<SavedReplyImportResult> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden('inbox.savedreply.manage');
    const userId = ctx.userId;
    const parsed = parseCsv(decodeRepliesUpload(file));
    const header = parsed.records[0];
    const idx = header ? columnIndexes(header.cells) : null;
    if (!idx) {
      throw invalidFile('The first row must name the columns title, shortcut and body.');
    }
    const data = parsed.records.slice(1);
    if (data.length === 0) throw invalidFile('The file has a header row but no replies.');
    if (data.length > SAVED_REPLY_IMPORT_MAX_ROWS) {
      throw invalidFile(
        `The file has ${data.length} rows; the limit is ${SAVED_REPLY_IMPORT_MAX_ROWS}. Split it.`,
      );
    }

    // 1. each row on its own, then a shortcut repeated in the file is reported on its later rows
    const seen = new Set<string>();
    const rows: RowParse[] = data.map((rec) => {
      const r = parseRow(rec, idx);
      if (!r.ok) return r;
      if (seen.has(r.row.shortcut)) {
        return {
          ok: false,
          line: r.row.line,
          shortcut: r.row.shortcut,
          issue: 'duplicate_in_file',
        };
      }
      seen.add(r.row.shortcut);
      return r;
    });

    const cap = await this.entitlements.limit(ctx.orgId, 'saved_replies');
    return this.db.tx(async (tx) => {
      const valid = rows.filter((r): r is Extract<RowParse, { ok: true }> => r.ok);
      const existing = await this.repo.sharedByShortcuts(
        tx,
        ctx.orgId,
        valid.map((r) => r.row.shortcut),
      );
      const used = await this.repo.total(tx, ctx.orgId);
      let held = used;

      const report: SavedReplyImportResult['rows'] = [];
      const totals = { rows: data.length, create: 0, update: 0, skip: 0, invalid: 0 };
      const note = (
        line: number,
        shortcut: string,
        action: SavedReplyImportResult['rows'][number]['action'],
        issue: SavedReplyImportResult['rows'][number]['issue'],
      ) => {
        totals[action] += 1;
        if (action !== 'create') report.push({ line, shortcut, action, issue });
      };

      for (const r of rows) {
        if (!r.ok) {
          note(r.line, r.shortcut, 'invalid', r.issue);
          continue;
        }
        const c = r.row;
        const found = existing.get(c.shortcut);
        if (found) {
          if (options.duplicatePolicy === 'skip') {
            note(c.line, c.shortcut, 'skip', 'duplicate');
            continue;
          }
          if (!options.dryRun) await this.overwrite(tx, ctx.orgId, found, c);
          note(c.line, c.shortcut, 'update', null);
          continue;
        }
        if (cap > 0 && held >= cap) {
          note(c.line, c.shortcut, 'invalid', 'plan_limit_reached');
          continue;
        }
        held += 1;
        if (!options.dryRun) await this.create(tx, ctx.orgId, userId, c);
        note(c.line, c.shortcut, 'create', null);
      }

      // Problems first, then the rest, as many as fit.
      report.sort((a, b) => Number(b.action === 'invalid') - Number(a.action === 'invalid'));
      const shown = report.slice(0, SAVED_REPLY_IMPORT_ROWS_SHOWN);
      return {
        dryRun: options.dryRun,
        duplicatePolicy: options.duplicatePolicy,
        totals,
        rows: shown,
        rowsTruncated: report.length > shown.length,
        plan: {
          limit: cap > 0 ? cap : null,
          used: options.dryRun ? used : held,
          remaining: cap > 0 ? Math.max(0, cap - (options.dryRun ? used : held)) : null,
        },
      };
    });
  }

  private async create(tx: Tx, orgId: number, userId: number, c: ImportCandidate): Promise<void> {
    const created = await this.repo.insert(tx, orgId, {
      ownerId: null,
      createdBy: userId,
      shortcut: c.shortcut,
      title: c.title,
      body: c.body,
      category: c.category,
      language: c.language,
      channelKinds: c.channelKinds,
    });
    await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: created.id,
      eventType: 'inbox.saved_reply.created',
      payload: { savedReplyId: created.uuid, shortcut: c.shortcut, scope: 'shared' },
    });
  }

  private async overwrite(
    tx: Tx,
    orgId: number,
    found: { id: number; uuid: string; rowVersion: number },
    c: ImportCandidate,
  ): Promise<void> {
    const ok = await this.repo.update(tx, orgId, found.id, found.rowVersion, {
      title: c.title,
      body: c.body,
      category: c.category,
      language: c.language,
      channelKinds: c.channelKinds,
    });
    if (!ok) throw AppError.rowVersionConflict('Saved reply');
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: found.id,
      action: 'update',
      delta: { source: { old: null, new: 'csv_import' } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: found.id,
      eventType: 'inbox.saved_reply.updated',
      payload: { savedReplyId: found.uuid, shortcut: c.shortcut, scope: 'shared' },
    });
  }
}

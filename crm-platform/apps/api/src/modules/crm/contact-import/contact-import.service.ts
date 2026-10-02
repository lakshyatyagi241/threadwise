import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_SAMPLE_HEADERS,
  IMPORT_SAMPLE_ROWS,
  IMPORT_SYNC_MAX_ROWS,
  detectImportColumns,
  type ContactImportJob,
  type ContactImportOptions,
  type ContactImportPreview,
  type ImportRowIssue,
  type ListImportJobsQuery,
  type PageResponse,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { QUEUES } from '../../../infra/queue/queues';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { csvLine, guardFormula } from '../contact-bulk/csv-writer';
import { ContactQuotaService } from '../contacts/contact-quota.service';
import { ContactGroupsRepository } from '../contact-groups/contact-groups.repository';
import { ContactImportEngine } from './contact-import.engine';
import { toImportJobResponse } from './contact-import.mapper';
import { ContactImportRepository } from './contact-import.repository';
import { parseCsv } from './csv-parser';
import {
  extractRow,
  missingRequired,
  resolveMapping,
  type ParsedRow,
  type ResolvedMapping,
} from './import-rows';

const { contactGroups, tags: tagsTable } = schema;

const INVALID_SAMPLES = 20;
const NAME_LIST_MAX = 50;
const CSV_MIMES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

export interface UploadedCsv {
  originalname: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

const fileInvalid = (message: string, details?: Array<{ path: string; message: string }>) =>
  new AppError(
    ERROR_CODES.CON_IMPORT_FILE_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    details,
  );

/** The upload as text: size, type and encoding checked once. */
export function decodeUpload(file: UploadedCsv | undefined): {
  text: string;
  name: string;
  size: number;
} {
  if (!file?.buffer) throw fileInvalid('Choose a CSV file to upload.');
  if (file.buffer.length > IMPORT_MAX_BYTES) {
    throw new AppError(
      ERROR_CODES.CON_IMPORT_TOO_LARGE,
      `The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  const okName = /\.(csv|txt)$/i.test(file.originalname);
  if (!okName && !(file.mimetype && CSV_MIMES.has(file.mimetype))) {
    throw fileInvalid('Upload a .csv or .txt file.');
  }
  // A real spreadsheet (.xlsx is a zip) or any other binary has NUL bytes; a text file never does.
  if (file.buffer.includes(0))
    throw fileInvalid('This is not a text CSV file. Export it as CSV first.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch {
    // Files saved by older spreadsheet versions are Windows-1252, not UTF-8.
    text = new TextDecoder('windows-1252').decode(file.buffer);
  }
  return {
    text,
    name: file.originalname.slice(0, 255) || 'contacts.csv',
    size: file.buffer.length,
  };
}

/** The sample file, built from the importer's own header names. */
export function sampleCsv(): string {
  return (
    csvLine([...IMPORT_SAMPLE_HEADERS]) + IMPORT_SAMPLE_ROWS.map((r) => csvLine([...r])).join('')
  );
}

interface Analysis {
  delimiter: string;
  headers: string[];
  mapping: ResolvedMapping;
  totalRows: number;
  valid: ParsedRow[];
  invalid: ImportRowIssue[];
  invalidCount: number;
  missing: ReturnType<typeof missingRequired>;
  sampleRows: Array<Record<string, string>>;
}

/** Parse, map and validate a whole file: no database, so the preview and the start share it. */
export function analyzeCsv(text: string, options: ContactImportOptions): Analysis {
  const parsed = parseCsv(text, options.delimiter);
  const header = parsed.records[0];
  if (!header || header.cells.every((c) => c.trim() === ''))
    throw fileInvalid('The file is empty.');
  const headers = header.cells.map((h) => h.trim());
  const data = parsed.records.slice(1);
  if (data.length === 0) throw fileInvalid('The file has a header row but no contacts.');
  if (data.length > IMPORT_MAX_ROWS) {
    throw new AppError(
      ERROR_CODES.CON_IMPORT_TOO_LARGE,
      `The file has ${data.length} rows; the limit is ${IMPORT_MAX_ROWS}. Split it.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  const mapping = resolveMapping(headers, options.mapping);
  const valid: ParsedRow[] = [];
  const invalid: ImportRowIssue[] = [];
  let invalidCount = 0;
  for (const rec of data) {
    const r = extractRow(rec, mapping, headers, { defaultCountryCode: options.defaultCountryCode });
    if (r.ok) valid.push(r.row);
    else {
      invalidCount += 1;
      if (invalid.length < INVALID_SAMPLES) {
        invalid.push({ row: r.line, reason: r.reason, values: r.values });
      }
    }
  }
  const sampleRows = data.slice(0, 5).map((rec) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      out[h || `column_${i + 1}`] = rec.cells[i] ?? '';
    });
    return out;
  });
  return {
    delimiter: parsed.delimiter,
    headers,
    mapping,
    totalRows: data.length,
    valid,
    invalid,
    invalidCount,
    missing: missingRequired(mapping),
    sampleRows,
  };
}

const lower = (s: string) => s.toLowerCase();

/**
 * CSV import: preview, start, progress, rejects, the sample file (TW-CON-027..032).
 *
 * `POST /contacts/import` runs a small file (up to 1,000 rows) inside the request and answers 200
 * with the finished result; a bigger one is stored, queued on the con-import queue and answered
 * 202 with a job to poll. Both go through the same engine.
 */
@Injectable()
export class ContactImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: ContactImportRepository,
    private readonly engine: ContactImportEngine,
    private readonly quota: ContactQuotaService,
    private readonly groupsRepo: ContactGroupsRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @InjectQueue(QUEUES.CON_IMPORT) private readonly queue: Queue,
  ) {}

  // --- preview ------------------------------------------------------------------------------

  async preview(
    file: UploadedCsv | undefined,
    options: ContactImportOptions,
  ): Promise<ContactImportPreview> {
    const ctx = RequestContextStore.require();
    const upload = decodeUpload(file);
    const a = analyzeCsv(upload.text, options);

    return this.db.tx(async (tx) => {
      const keys = [...new Set(a.valid.map((r) => r.phone))];
      const existing = await this.engine.findExisting(tx, ctx.orgId, keys);
      const willUpdate = keys.filter((k) => existing.has(k)).length;

      const groupNames = distinct(a.valid.flatMap((r) => r.groups));
      const tagNames = distinct(a.valid.flatMap((r) => r.tags));
      const newGroups = await this.missingNames(tx, ctx.orgId, 'group', groupNames);
      const newTags = await this.missingNames(tx, ctx.orgId, 'tag', tagNames);
      const usage = await this.quota.usage(tx, ctx.orgId);

      const mapping: Record<string, number | null> = {};
      for (const f of IMPORT_FIELDS) mapping[f] = a.mapping[f] ?? null;
      return {
        fileName: upload.name,
        delimiter: a.delimiter,
        headers: a.headers,
        detected: detectImportColumns(a.headers),
        mapping,
        missingRequired: a.missing,
        sampleRows: a.sampleRows,
        totals: {
          rows: a.totalRows,
          valid: a.valid.length,
          invalid: a.invalidCount,
          duplicateInFile: a.valid.length - keys.length,
          willCreate: keys.length - willUpdate,
          willUpdate,
        },
        invalidSamples: a.invalid,
        newGroups: newGroups.slice(0, NAME_LIST_MAX),
        newTags: newTags.slice(0, NAME_LIST_MAX),
        quota: usage,
        runsAsJob: a.totalRows > IMPORT_SYNC_MAX_ROWS,
      };
    });
  }

  /** Names (any case) of the groups or tags that do not exist yet. */
  private async missingNames(
    tx: Tx,
    orgId: number,
    kind: 'group' | 'tag',
    names: string[],
  ): Promise<string[]> {
    if (names.length === 0) return [];
    const have = new Set<string>();
    for (let i = 0; i < names.length; i += 1000) {
      const chunk = names.slice(i, i + 1000).map(lower);
      const rows =
        kind === 'group'
          ? await tx
              .select({ name: contactGroups.name })
              .from(contactGroups)
              .where(
                and(
                  eq(contactGroups.orgId, orgId),
                  inArray(sql`lower(${contactGroups.name})`, chunk),
                ),
              )
          : await tx
              .select({ name: sql<string>`${tagsTable.name}::text` })
              .from(tagsTable)
              .where(
                and(
                  eq(tagsTable.orgId, orgId),
                  inArray(sql`lower(${tagsTable.name}::text)`, chunk),
                ),
              );
      rows.forEach((r) => have.add(lower(r.name)));
    }
    return names.filter((n) => !have.has(lower(n)));
  }

  // --- start --------------------------------------------------------------------------------

  async start(
    file: UploadedCsv | undefined,
    options: ContactImportOptions,
  ): Promise<{ job: ContactImportJob; queued: boolean }> {
    const ctx = RequestContextStore.require();
    const canCreate = (key: string) => this.rbac.can(ctx.grants!, key).allowed;
    if (!canCreate('record.contacts.create')) throw AppError.forbidden('record.contacts.create');

    // The plan gate comes first, before anything about the file is looked at (TW-CON-026).
    await this.db.tx((tx) => this.quota.assertCanAddOne(tx, ctx.orgId));

    const upload = decodeUpload(file);
    const a = analyzeCsv(upload.text, options);
    if (a.missing.length > 0) {
      throw fileInvalid(
        `The file has no ${a.missing.join(' or ')} column. Map the columns, or rename the headers.`,
        a.missing.map((f) => ({ path: 'mapping', message: f })),
      );
    }
    if (a.valid.length === 0) {
      throw fileInvalid(
        'No row in the file could be imported.',
        a.invalid.map((i) => ({
          path: `row ${i.row}`,
          message: i.reason,
        })),
      );
    }

    const created = await this.db.tx(async (tx) => {
      // knobs must name things in this workspace
      if (options.groupId) {
        const found = await this.groupsRepo.resolveIds(tx, ctx.orgId, [options.groupId]);
        if (!found.has(options.groupId)) throw AppError.notFound('Contact group', options.groupId);
      }
      if (options.tagIds?.length) {
        const rows = await tx
          .select({ uuid: tagsTable.uuid })
          .from(tagsTable)
          .where(and(eq(tagsTable.orgId, ctx.orgId), inArray(tagsTable.uuid, options.tagIds)));
        const have = new Set(rows.map((r) => r.uuid));
        const missing = options.tagIds.find((t) => !have.has(t));
        if (missing) throw AppError.notFound('Tag', missing);
      }
      // creating groups and tags is its own permission
      const newGroups = await this.missingNames(
        tx,
        ctx.orgId,
        'group',
        distinct(a.valid.flatMap((r) => r.groups)),
      );
      const newTags = await this.missingNames(
        tx,
        ctx.orgId,
        'tag',
        distinct(a.valid.flatMap((r) => r.tags)),
      );
      if (newGroups.length > 0 && !canCreate('record.contact-groups.create')) {
        throw AppError.forbidden('record.contact-groups.create');
      }
      if (newTags.length > 0 && !canCreate('record.tags.create')) {
        throw AppError.forbidden('record.tags.create');
      }

      const job = await this.jobs.insert(tx, ctx.orgId, {
        createdBy: ctx.userId,
        fileName: upload.name,
        byteSize: upload.size,
        totalRows: a.totalRows,
        // the mapping that was resolved, so a retry or a later look maps columns the same way
        options: {
          ...options,
          delimiter: a.delimiter,
          mapping: Object.fromEntries(IMPORT_FIELDS.map((f) => [f, a.mapping[f] ?? null])),
        },
        sourceCsv: upload.text,
      });
      await this.audit.record(tx, {
        module: 'contact_import_jobs',
        recordId: job.id,
        action: 'insert',
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'contact_import_jobs',
        aggregateId: job.id,
        eventType: 'contact.import_started',
        payload: { uuid: job.uuid, fileName: upload.name, totalRows: a.totalRows },
      });
      return job;
    });

    if (a.totalRows <= IMPORT_SYNC_MAX_ROWS) {
      await this.engine.run(ctx.orgId, ctx.userId, created.id);
      return { job: await this.getJob(created.uuid), queued: false };
    }

    try {
      await this.queue.add(
        'contact-import',
        { orgId: ctx.orgId, userId: ctx.userId, jobId: created.id },
        { jobId: `con-import-${ctx.orgId}-${created.id}` },
      );
    } catch (err) {
      await this.db.tx((tx) =>
        this.jobs.update(tx, ctx.orgId, created.id, {
          status: 'failed',
          error: 'Could not queue the import',
          finishedAt: new Date(),
          sourceCsv: null,
        }),
      );
      throw err;
    }
    return { job: toImportJobResponse(created), queued: true };
  }

  // --- progress and report -----------------------------------------------------------------

  async getJob(uuid: string): Promise<ContactImportJob> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.jobs.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Import', uuid);
      return toImportJobResponse(row);
    });
  }

  async listJobs(query: ListImportJobsQuery): Promise<PageResponse<ContactImportJob>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.jobs.list(tx, ctx.orgId, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toImportJobResponse), page };
    });
  }

  /** The rejected rows as a CSV: the line, the reason and the original cells, to fix and re-upload. */
  async rejectsCsv(uuid: string): Promise<string> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.jobs.findByUuid(tx, ctx.orgId, uuid));
    if (!row) throw AppError.notFound('Import', uuid);

    const columns: string[] = [];
    for (const r of row.rejects)
      for (const k of Object.keys(r.values ?? {})) if (!columns.includes(k)) columns.push(k);
    let out = csvLine(['row', 'reason', ...columns]);
    for (const r of row.rejects) {
      out += csvLine([r.row, r.reason, ...columns.map((c) => guardFormula(r.values?.[c] ?? ''))]);
    }
    return out;
  }
}

function distinct(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) if (!seen.has(lower(n))) seen.set(lower(n), n);
  return [...seen.values()];
}

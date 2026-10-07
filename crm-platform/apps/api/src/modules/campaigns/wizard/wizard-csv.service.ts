import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  WIZARD_CSV_MAX_BYTES,
  WIZARD_CSV_TEMPLATE_HEADERS,
  WIZARD_CSV_TEMPLATE_ROWS,
  WIZARD_CSV_TTL_DAYS,
  type WizardAudience,
  type WizardCsvReport,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  ContactResolverService,
  UTF8_BOM,
  csvLine,
  decodeUpload,
  type UploadedCsv,
} from '../../crm';
import { parseWizardCsv } from './wizard-csv-parse';
import { csvMatchedLines, csvNewRowsWhere } from './wizard-csv-sql';

const { campWizardCsv, campWizardCsvRows } = schema;
/** Rows per INSERT. */
const CHUNK = 1000;
/** Rows of the preview and of the issue list the report carries (the download has them all). */
const PREVIEW_ROWS = 10;
const ISSUE_ROWS = 50;

const REASON_TEXT = {
  missing_phone: 'No phone number in this row',
  invalid_phone:
    'Not a valid phone number (use the international format, for example +919812345678)',
  duplicate: 'The same number appears in an earlier row (that row is used)',
} as const;

/** A cell of the error list: a value that a spreadsheet would read as a formula is written as text. */
const safe = (v: string): string => (/^(?:[=@\t\r]|[+-][^\d\s().])/.test(v) ? `'${v}` : v);

export interface CsvUploadRef {
  id: number;
  uuid: string;
}

/**
 * The "Broadcast via CSV" audience: upload, validation, the stored result and its use. The file is parsed ONCE on the server and the
 * valid numbers are stored per tenant (forced RLS), so the count, the sample and the launch read the list the person previewed.
 *
 * How the numbers become recipients: a campaign recipient is a contact, so at LAUNCH (in the launch transaction) every valid number
 * that is not a contact yet becomes one (`ContactResolverService`, the CRM's find-or-create by phone: the plan's contact cap and the
 * workspace's defaults apply). Before launch nothing is written to the contacts, only counted. Numbers that already are contacts are
 * matched by phone and used as they are, so an opted-out contact in the file is skipped like anywhere else.
 */
@Injectable()
export class WizardCsvService {
  constructor(
    private readonly db: DatabaseService,
    private readonly resolver: ContactResolverService,
  ) {}

  async upload(file: UploadedCsv | undefined): Promise<WizardCsvReport> {
    const { orgId, userId } = RequestContextStore.require();
    if (file?.buffer && file.buffer.length > WIZARD_CSV_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.CON_IMPORT_TOO_LARGE,
        `The file is larger than ${WIZARD_CSV_MAX_BYTES / 1024 / 1024} MB.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const { text, name } = decodeUpload(file);
    const parsed = parseWizardCsv(text, await this.resolver.defaultCountryCode());
    return this.db.tx(async (tx) => {
      const [created] = await tx
        .insert(campWizardCsv)
        .values({
          orgId,
          fileName: name,
          totalRows: parsed.lines.length,
          validCount: parsed.valid,
          duplicateCount: parsed.duplicate,
          invalidCount: parsed.invalid,
          createdBy: userId,
          expiresAt: sql`now() + ${`${WIZARD_CSV_TTL_DAYS} days`}::interval`,
        })
        .returning({ id: campWizardCsv.id, uuid: campWizardCsv.uuid });
      for (let i = 0; i < parsed.lines.length; i += CHUNK) {
        await tx.insert(campWizardCsvRows).values(
          parsed.lines.slice(i, i + CHUNK).map((l) => ({
            orgId,
            uploadId: created!.id,
            line: l.line,
            kind: l.kind,
            rawValue: l.raw || null,
            phone: l.phone,
            digits: l.digits,
            name: l.name,
            reason: l.reason,
          })),
        );
      }
      return (await this.reportOf(tx, orgId, created!.uuid))!;
    });
  }

  /** The stored upload and what it comes to now (opted-out and existing contacts are read live). */
  async report(uuid: string): Promise<WizardCsvReport> {
    const { orgId } = RequestContextStore.require();
    const out = await this.db.tx((tx) => this.reportOf(tx, orgId, uuid));
    if (!out) throw AppError.notFound('CSV upload', uuid);
    return out;
  }

  /** The rejected rows (invalid and repeated numbers) with their line numbers, as the CSV the person downloads. */
  async errorsCsv(uuid: string): Promise<string> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const up = await this.find(tx, orgId, uuid);
      if (!up) throw AppError.notFound('CSV upload', uuid);
      const res = await tx.execute(sql`
        SELECT line, raw_value, reason FROM camp_wizard_csv_rows
        WHERE org_id = ${orgId} AND upload_id = ${up.id} AND kind <> 'valid' ORDER BY line`);
      const rows = res.rows as Array<{ line: number; raw_value: string | null; reason: string }>;
      return (
        UTF8_BOM +
        csvLine(['line', 'value', 'problem']) +
        rows
          .map((r) =>
            csvLine([
              r.line,
              safe(r.raw_value ?? ''),
              REASON_TEXT[r.reason as keyof typeof REASON_TEXT] ?? r.reason,
            ]),
          )
          .join('')
      );
    });
  }

  template(): string {
    return (
      UTF8_BOM +
      csvLine([...WIZARD_CSV_TEMPLATE_HEADERS]) +
      WIZARD_CSV_TEMPLATE_ROWS.map((r) => csvLine([...r])).join('')
    );
  }

  async find(tx: Tx, orgId: number, uuid: string): Promise<CsvUploadRef | undefined> {
    const res = await tx.execute(
      sql`SELECT id, uuid FROM camp_wizard_csv WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string; uuid: string } | undefined;
    return r ? { id: Number(r.id), uuid: r.uuid } : undefined;
  }

  /** A recurring broadcast reads its upload on every run, so it is kept (no expiry) once the series exists. */
  async pin(tx: Tx, orgId: number, audience: WizardAudience): Promise<void> {
    if (!audience.csv) return;
    await tx.execute(
      sql`UPDATE camp_wizard_csv SET expires_at = NULL WHERE org_id = ${orgId} AND uuid = ${audience.csv.id}::uuid`,
    );
  }

  /** The worker's retention pass: uploads past their expiry go, rows with them. Privileged (every tenant). */
  async purgeExpired(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM camp_wizard_csv WHERE expires_at IS NOT NULL AND expires_at < now()`,
      );
      return res.rowCount ?? 0;
    });
  }

  /** The valid numbers that are not contacts yet, in file order, in chunks (for the launch). */
  async newNumbers(
    tx: Tx,
    orgId: number,
    uploadId: number,
    afterLine: number,
    limit: number,
  ): Promise<Array<{ line: number; phone: string; name: string | null }>> {
    const res = await tx.execute(sql`
      SELECT r.line, r.phone, r.name FROM camp_wizard_csv_rows r
      WHERE ${csvNewRowsWhere(orgId, uploadId)} AND r.line > ${afterLine}
      ORDER BY r.line LIMIT ${limit}`);
    return (res.rows as Array<{ line: number; phone: string; name: string | null }>).map((r) => ({
      line: Number(r.line),
      phone: r.phone,
      name: r.name,
    }));
  }

  private async reportOf(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<WizardCsvReport | undefined> {
    const upRes = await tx.execute(sql`
      SELECT id, uuid, file_name, total_rows, valid_count, duplicate_count, invalid_count, expires_at
      FROM camp_wizard_csv WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const up = upRes.rows[0] as
      | {
          id: number | string;
          uuid: string;
          file_name: string;
          total_rows: number;
          valid_count: number;
          duplicate_count: number;
          invalid_count: number;
          expires_at: Date | string | null;
        }
      | undefined;
    if (!up) return undefined;
    const id = Number(up.id);
    const owned = csvMatchedLines(orgId, id, sql`true`);
    const optedOut = csvMatchedLines(orgId, id, sql`c.is_unsubscribed`);
    const counts = (
      await tx.execute(sql`
        SELECT (SELECT count(*) FROM camp_wizard_csv_rows r WHERE ${csvNewRowsWhere(orgId, id)})::int AS fresh,
               (SELECT count(*) FROM (${optedOut}) b)::int AS opted_out`)
    ).rows[0] as { fresh: number; opted_out: number };
    const status = sql`CASE
        WHEN r.line IN (${optedOut}) THEN 'optedOut'
        WHEN r.line IN (${owned}) THEN 'existing'
        ELSE 'new' END`;
    const preview = (
      await tx.execute(sql`
        SELECT r.line, r.phone, r.name, ${status} AS status FROM camp_wizard_csv_rows r
        WHERE r.org_id = ${orgId} AND r.upload_id = ${id} AND r.kind = 'valid' ORDER BY r.line LIMIT ${PREVIEW_ROWS}`)
    ).rows as Array<{
      line: number;
      phone: string;
      name: string | null;
      status: 'new' | 'existing' | 'optedOut';
    }>;
    const issues = (
      await tx.execute(sql`
        SELECT line, raw_value, reason FROM camp_wizard_csv_rows
        WHERE org_id = ${orgId} AND upload_id = ${id} AND kind <> 'valid' ORDER BY line LIMIT ${ISSUE_ROWS}`)
    ).rows as Array<{
      line: number;
      raw_value: string | null;
      reason: WizardCsvReport['issues'][number]['reason'];
    }>;
    const fresh = Number(counts.fresh);
    return {
      id: up.uuid,
      fileName: up.file_name,
      totalRows: Number(up.total_rows),
      valid: Number(up.valid_count),
      duplicate: Number(up.duplicate_count),
      invalid: Number(up.invalid_count),
      optedOut: Number(counts.opted_out),
      existing: Math.max(0, Number(up.valid_count) - fresh),
      newContacts: fresh,
      preview: preview.map((r) => ({
        line: Number(r.line),
        phone: r.phone,
        name: r.name,
        status: r.status,
      })),
      issues: issues.map((r) => ({
        line: Number(r.line),
        value: r.raw_value ?? '',
        reason: r.reason,
      })),
      issuesTotal: Number(up.duplicate_count) + Number(up.invalid_count),
      expiresAt: up.expires_at ? new Date(up.expires_at).toISOString() : null,
    };
  }
}

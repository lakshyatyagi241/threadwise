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
  type WizardCsvUploadOptions,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { ConsentIntakeService } from '../../contact-consent';
import {
  ContactResolverService,
  UTF8_BOM,
  csvLine,
  decodeUpload,
  type UploadedCsv,
} from '../../crm';
import { parseWizardCsv } from './wizard-csv-parse';
import { csvContactsWhere, csvMatchedLines, csvNewRowsWhere } from './wizard-csv-sql';

const { campWizardCsv, campWizardCsvRows } = schema;
/** Rows per INSERT. */
const CHUNK = 1000;
/** Rows of the preview and of the issue list the report carries (the download has them all). */
/** Uploads (not pinned by a recurring broadcast) one workspace keeps at a time. */
const MAX_LIVE_UPLOADS = 20;
const PREVIEW_ROWS = 10;
/** Contacts granted per query when the uploader confirmed consent for the file. */
const CHUNK_GRANTS = 500;
const ISSUE_ROWS = 50;

const REASON_TEXT = {
  missing_phone: 'No phone number in this row',
  invalid_phone:
    'Not a valid phone number (use the international format, for example +919812345678)',
  duplicate: 'The same number appears in an earlier row (that row is used)',
} as const;

/** A cell of the error list: a value that a spreadsheet would read as a formula is written as text. */
const safe = (v: string): string =>
  /^[=+\-@\t\r]/.test(v) && !/^\+?[\d\s().-]+$/.test(v) ? `'${v}` : v;

export interface CsvUploadRef {
  id: number;
  uuid: string;
  fileName: string;
  createdBy: number | null;
  /** The uploader confirmed they hold consent for every number in the file (BL-170). */
  consentConfirmed: boolean;
  consentNoticeText: string | null;
  consentNoticeVersion: string | null;
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
    private readonly intake: ConsentIntakeService,
  ) {}

  async upload(
    file: UploadedCsv | undefined,
    options: WizardCsvUploadOptions = { consentConfirmed: false },
  ): Promise<WizardCsvReport> {
    const { orgId, userId } = RequestContextStore.require();
    if (file?.buffer && file.buffer.length > WIZARD_CSV_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.CON_IMPORT_TOO_LARGE,
        `The file is larger than ${WIZARD_CSV_MAX_BYTES / 1024 / 1024} MB.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const { text, name } = decodeUpload(file);
    await this.assertRoomForUpload(orgId);
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
          // The confirmation belongs to the upload (a recurring broadcast reads the same upload again). Without it the file records no
          // consent; the notice text and version are kept only with the confirmation they explain.
          consentConfirmed: options.consentConfirmed,
          consentNoticeText: options.consentConfirmed ? (options.consentNoticeText ?? null) : null,
          consentNoticeVersion: options.consentConfirmed
            ? (options.consentNoticeVersion ?? null)
            : null,
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

  /** Each upload keeps up to 10,000 rows for a week (longer when a series pins it), so a workspace may hold only so many at once. */
  private async assertRoomForUpload(orgId: number): Promise<void> {
    const res = await this.db.tx((tx) =>
      tx.execute(
        sql`SELECT count(*)::int AS n FROM camp_wizard_csv WHERE org_id = ${orgId} AND expires_at IS NOT NULL`,
      ),
    );
    if (Number((res.rows[0] as { n: number }).n) >= MAX_LIVE_UPLOADS) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        `This workspace already holds ${MAX_LIVE_UPLOADS} uploaded files that have not expired. Use one of them, or wait for one to expire (a week after it was uploaded).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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
      sql`SELECT id, uuid, file_name, created_by, consent_confirmed, consent_notice_text, consent_notice_version
          FROM camp_wizard_csv WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      | {
          id: number | string;
          uuid: string;
          file_name: string;
          created_by: number | string | null;
          consent_confirmed: boolean;
          consent_notice_text: string | null;
          consent_notice_version: string | null;
        }
      | undefined;
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid,
          fileName: r.file_name,
          createdBy: r.created_by === null ? null : Number(r.created_by),
          consentConfirmed: r.consent_confirmed,
          consentNoticeText: r.consent_notice_text,
          consentNoticeVersion: r.consent_notice_version,
        }
      : undefined;
  }

  /**
   * Records the consent the uploader confirmed for this file (BL-170, privacy spec 4.3.2): a WhatsApp marketing grant for every
   * contact one of the file's valid numbers belongs to, with the file, the upload and the notice wording and version they stated as
   * proof (source `import`). Nothing when the upload has no confirmation. A contact that opted out is never turned back on
   * (`respectWithdrawn`), and one grant per contact and upload is all that is ever written, so a recurring broadcast that reads the
   * upload again adds nothing. Returns the number of grants written now.
   */
  async grantConsent(tx: Tx, orgId: number, up: CsvUploadRef): Promise<number> {
    if (!up.consentConfirmed) return 0;
    let after = 0;
    let written = 0;
    for (;;) {
      const res = await tx.execute(sql`
        SELECT contacts.id FROM contacts
        WHERE contacts.org_id = ${orgId} AND ${csvContactsWhere(orgId, up.id)} AND contacts.id > ${after}::bigint
        ORDER BY contacts.id LIMIT ${CHUNK_GRANTS}`);
      const ids = (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
      if (ids.length === 0) break;
      for (const contactId of ids) {
        const recorded = await this.intake.grant(tx, orgId, {
          contactId,
          channels: ['whatsapp'],
          source: 'import',
          proof: {
            ...(up.consentNoticeText ? { text: up.consentNoticeText } : {}),
            ...(up.consentNoticeVersion ? { version: up.consentNoticeVersion } : {}),
          },
          evidence: { fileName: up.fileName, reference: `wizard_csv:${up.uuid}` },
          actorUserId: up.createdBy,
          keyBase: `wizcsv:${up.uuid}:${contactId}`,
          fallbackNote: up.consentNoticeText
            ? 'The person uploading confirmed consent for this file, under the notice they stated'
            : 'The person uploading confirmed consent for this file',
        });
        written += recorded.length;
      }
      after = ids[ids.length - 1]!;
    }
    return written;
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
      // An upload pinned for a recurring broadcast is let go (kept a week more) once no active or paused series uses it: the series
      // was cancelled, ended or deleted.
      await tx.execute(sql`
        UPDATE camp_wizard_csv u SET expires_at = now() + ${`${WIZARD_CSV_TTL_DAYS} days`}::interval
        WHERE u.expires_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM camp_series s
          WHERE s.org_id = u.org_id AND s.status IN ('active', 'paused')
            AND s.blueprint -> 'audience' -> 'csv' ->> 'id' = u.uuid::text)`);
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
      SELECT id, uuid, file_name, total_rows, valid_count, duplicate_count, invalid_count, expires_at,
             consent_confirmed, consent_notice_version
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
          consent_confirmed: boolean;
          consent_notice_version: string | null;
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
      consentConfirmed: up.consent_confirmed,
      consentNoticeVersion: up.consent_notice_version,
    };
  }
}

import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  WIZARD_CSV_MAX_ROWS,
  canonicalizeLocalPhone,
  composeDisplayName,
  countryCodeDigits,
  detectImportColumns,
  type WizardCsvRejectReason,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { parseCsv } from '../../crm';

/** One line of the uploaded file after the check. */
export interface CsvLine {
  /** Line in the file, the header included (the first data row is line 2). */
  line: number;
  kind: 'valid' | 'duplicate' | 'invalid';
  /** The phone cell as written. */
  raw: string;
  /** E.164 with the plus, and its digits (a valid row only). */
  phone: string | null;
  digits: string | null;
  name: string | null;
  reason: WizardCsvRejectReason | null;
}

export interface ParsedCsvUpload {
  lines: CsvLine[];
  valid: number;
  duplicate: number;
  invalid: number;
}

/** A number WhatsApp can be asked to deliver to (E.164: 8 to 15 digits, no leading zero), as `VALID_NUMBER` says in SQL. */
const DELIVERABLE = /^[1-9][0-9]{7,14}$/;

const fileInvalid = (message: string) =>
  new AppError(ERROR_CODES.CON_IMPORT_FILE_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Reads a CSV of phone numbers: a header row with a column the contact importer calls a phone (`phone`, `mobile`, ...), and optionally
 * a name (`name`, or `first_name` and `last_name`) and a `country_code`. Every number goes through the same canonicaliser the rest of
 * the app uses (`canonicalizeLocalPhone`, with the workspace's default country for a number that does not announce its own), so a
 * number is valid here exactly when a contact could be created with it. A number repeated in the file is kept once (the first row).
 *
 * No database: the same text always gives the same answer, so the preview and the stored upload agree.
 */
export function parseWizardCsv(text: string, defaultCountryCode: string | null): ParsedCsvUpload {
  const parsed = parseCsv(text);
  const header = parsed.records[0];
  if (!header || header.cells.every((c) => c.trim() === ''))
    throw fileInvalid('The file is empty.');
  const columns = detectImportColumns(header.cells.map((h) => h.trim()));
  if (columns.phone === undefined) {
    throw fileInvalid(
      'The first row must name the columns, and one of them must be "phone" (or "mobile"). Download the template to see the format.',
    );
  }
  const data = parsed.records.slice(1);
  if (data.length === 0) throw fileInvalid('The file has a header row but no numbers.');
  if (data.length > WIZARD_CSV_MAX_ROWS) {
    throw new AppError(
      ERROR_CODES.CON_IMPORT_TOO_LARGE,
      `The file has ${data.length} rows; a broadcast takes at most ${WIZARD_CSV_MAX_ROWS} from a CSV. Split it, or import the contacts and use a group.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  const cell = (cells: string[], field: string): string => {
    const idx = columns[field];
    return idx === undefined ? '' : (cells[idx] ?? '').trim();
  };
  const seen = new Set<string>();
  const lines: CsvLine[] = [];
  let valid = 0;
  let duplicate = 0;
  let invalid = 0;
  for (const rec of data) {
    const raw = cell(rec.cells, 'phone').slice(0, 200);
    const base = { line: rec.line, raw, phone: null, digits: null, name: null };
    if (!raw) {
      invalid += 1;
      lines.push({ ...base, kind: 'invalid', reason: 'missing_phone' });
      continue;
    }
    // A country code column wins over the workspace default, the way the importer reads it.
    const own = countryCodeDigits(cell(rec.cells, 'countryCode'));
    const phone = canonicalizeLocalPhone(raw, own ? `+${own}` : defaultCountryCode);
    // The same bar the audience applies to every contact (8 to 15 digits): a number that passes here is one that can be messaged.
    if (!phone || !DELIVERABLE.test(phone.digits)) {
      invalid += 1;
      lines.push({ ...base, kind: 'invalid', reason: 'invalid_phone' });
      continue;
    }
    if (seen.has(phone.digits)) {
      duplicate += 1;
      lines.push({
        ...base,
        kind: 'duplicate',
        reason: 'duplicate',
        phone: phone.e164,
        digits: phone.digits,
      });
      continue;
    }
    seen.add(phone.digits);
    valid += 1;
    const name = composeDisplayName({
      name: cell(rec.cells, 'name'),
      firstName: cell(rec.cells, 'firstName'),
      lastName: cell(rec.cells, 'lastName'),
    });
    lines.push({
      ...base,
      kind: 'valid',
      reason: null,
      phone: phone.e164,
      digits: phone.digits,
      name: name ? name.slice(0, 255) : null,
    });
  }
  return { lines, valid, duplicate, invalid };
}

/** The file to download as the starting point: the column names the reader recognises, and two example rows. */
export const WIZARD_CSV_TEMPLATE_HEADERS = ['phone', 'first_name', 'last_name'] as const;
export const WIZARD_CSV_TEMPLATE_ROWS: ReadonlyArray<readonly string[]> = [
  ['+919812345678', 'Aarav', 'Sharma'],
  ['+919898765432', 'Priya', 'Patel'],
];

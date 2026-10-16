import {
  GROUP_NAME_MAX,
  IMPORT_FIELDS,
  TAG_NAME_MAX,
  canonicalZone,
  canonicalizePhone,
  composeDisplayName,
  detectImportColumns,
  parseImportBirthDate,
  parseImportConsent,
  type ImportConsentValue,
  type ImportField,
  type ImportMapping,
  type ImportRejectReason,
} from '@crm/contracts';

/** A row that passed validation, with every cell already normalised. */
export interface ParsedRow {
  /** Line in the file, header included. */
  line: number;
  name: string;
  firstName?: string;
  lastName?: string;
  /** E.164, the key duplicates are found by. */
  phone: string;
  email?: string;
  countryCode?: string;
  language?: string;
  title?: string;
  address?: string;
  memo?: string;
  status?: string;
  source?: string;
  /** An IANA zone (canonical spelling), only when the file has a time zone column and the cell is a real zone. */
  timezone?: string;
  /** A year-first date of birth that can be believed (BL-190). */
  dateOfBirth?: string;
  /** The minor column said yes: flag the contact (source `import`). No, blank and unknown words are left out: a file never clears a flag. */
  minor?: true;
  groups: string[];
  tags: string[];
  /** What the consent column says, only when a column is mapped (`blank` is left out so a later row for the same number can refine it). */
  consent?: Exclude<ImportConsentValue, 'blank'>;
  /** A column is mapped to consent, so this row counts as "not granted" when `consent` is absent. */
  consentColumn?: boolean;
  /** The cell as written, kept only when it was neither yes nor no (the preview shows a few). */
  consentRaw?: string;
  /** The same for the SMS and email consent columns (BL-170); read only when a column is mapped. */
  consentSms?: Exclude<ImportConsentValue, 'blank'>;
  consentSmsColumn?: boolean;
  consentSmsRaw?: string;
  consentEmail?: Exclude<ImportConsentValue, 'blank'>;
  consentEmailColumn?: boolean;
  consentEmailRaw?: string;
}

export type RowResult =
  | { ok: true; row: ParsedRow }
  | { ok: false; line: number; reason: ImportRejectReason; values: Record<string, string> };

export type ResolvedMapping = Partial<Record<ImportField, number>>;

/** Detected from the header, overridden by what the caller sent (null un-maps a field). */
export function resolveMapping(
  headers: readonly string[],
  requested?: ImportMapping,
): ResolvedMapping {
  const mapping: ResolvedMapping = { ...(detectImportColumns(headers) as ResolvedMapping) };
  for (const field of IMPORT_FIELDS) {
    const v = requested?.[field];
    if (v === null) delete mapping[field];
    else if (v !== undefined && v < headers.length) mapping[field] = v;
  }
  return mapping;
}

/** What the file needs for any row to be importable: a phone and some way to name the contact. */
export function missingRequired(mapping: ResolvedMapping): ImportField[] {
  const missing: ImportField[] = [];
  if (mapping.phone === undefined) missing.push('phone');
  if (
    mapping.name === undefined &&
    mapping.firstName === undefined &&
    mapping.lastName === undefined
  ) {
    missing.push('name');
  }
  return missing;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "VIP, New leads" -> ["VIP", "New leads"]; comma, semicolon or pipe; blanks and repeats dropped. */
export function splitList(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cell.split(/[,;|]/)) {
    const v = part.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

function rejectValues(
  headers: readonly string[],
  cells: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  headers.slice(0, 20).forEach((h, i) => {
    out[h || `column_${i + 1}`] = (cells[i] ?? '').slice(0, 200);
  });
  return out;
}

export function extractRow(
  record: { line: number; cells: string[] },
  mapping: ResolvedMapping,
  headers: readonly string[],
  opts: { defaultCountryCode?: string },
): RowResult {
  const cell = (field: ImportField): string => {
    const idx = mapping[field];
    return idx === undefined ? '' : (record.cells[idx] ?? '').trim();
  };
  const reject = (reason: ImportRejectReason): RowResult => ({
    ok: false,
    line: record.line,
    reason,
    values: rejectValues(headers, record.cells),
  });

  const name = composeDisplayName({
    name: cell('name'),
    firstName: cell('firstName'),
    lastName: cell('lastName'),
  });
  if (!name) return reject('missing_name');

  const rawPhone = cell('phone');
  if (!rawPhone) return reject('missing_phone');
  const phone = canonicalizePhone({
    number: rawPhone,
    countryCode: cell('countryCode'),
    defaultCountryCode: opts.defaultCountryCode,
  });
  if (!phone) return reject('invalid_phone');

  const email = cell('email').toLowerCase();
  if (email && (!EMAIL.test(email) || email.length > 255)) return reject('invalid_email');

  const rawZone = cell('timezone');
  const timezone = rawZone ? canonicalZone(rawZone) : null;
  if (rawZone && timezone === null) return reject('invalid_timezone');

  const groups = splitList(cell('group'));
  if (groups.some((g) => g.length > GROUP_NAME_MAX)) return reject('group_name_too_long');
  const tags = splitList(cell('tags'));
  if (tags.some((t) => t.length > TAG_NAME_MAX)) return reject('tag_name_too_long');

  // A date of birth must be year first and believable; a blank cell is simply no date.
  const dobCell = cell('dateOfBirth');
  const dateOfBirth = dobCell === '' ? undefined : (parseImportBirthDate(dobCell) ?? null);
  if (dateOfBirth === null) return reject('invalid_date_of_birth');
  const minor = mapping.minor !== undefined && parseImportConsent(cell('minor')) === 'granted';

  const opt = (v: string, max: number): string | undefined => (v ? v.slice(0, max) : undefined);
  const consentColumn = mapping.consent !== undefined;
  const consent = consentColumn ? parseImportConsent(cell('consent')) : undefined;
  const smsColumn = mapping.consentSms !== undefined;
  const consentSms = smsColumn ? parseImportConsent(cell('consentSms')) : undefined;
  const emailColumn = mapping.consentEmail !== undefined;
  const consentEmail = emailColumn ? parseImportConsent(cell('consentEmail')) : undefined;
  return {
    ok: true,
    row: {
      line: record.line,
      name: name.slice(0, 255),
      firstName: opt(cell('firstName'), 255),
      lastName: opt(cell('lastName'), 255),
      phone: phone.e164,
      email: email || undefined,
      countryCode: opt(cell('countryCode'), 10),
      language: opt(cell('language'), 80),
      title: opt(cell('title'), 50),
      address: opt(cell('address'), 1000),
      memo: opt(cell('memo'), 2000),
      status: opt(cell('status'), 64),
      source: opt(cell('source'), 128),
      ...(timezone ? { timezone } : {}),
      ...(dateOfBirth ? { dateOfBirth } : {}),
      ...(minor ? { minor: true as const } : {}),
      groups,
      tags,
      ...(consentColumn ? { consentColumn } : {}),
      ...(consent && consent !== 'blank' ? { consent } : {}),
      ...(consent === 'unrecognised' ? { consentRaw: cell('consent').slice(0, 40) } : {}),
      ...(smsColumn ? { consentSmsColumn: true } : {}),
      ...(consentSms && consentSms !== 'blank' ? { consentSms } : {}),
      ...(consentSms === 'unrecognised' ? { consentSmsRaw: cell('consentSms').slice(0, 40) } : {}),
      ...(emailColumn ? { consentEmailColumn: true } : {}),
      ...(consentEmail && consentEmail !== 'blank' ? { consentEmail } : {}),
      ...(consentEmail === 'unrecognised'
        ? { consentEmailRaw: cell('consentEmail').slice(0, 40) }
        : {}),
    },
  };
}

import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { queryBoolean } from './query-helpers';

/**
 * CSV import (TW-CON-027..032): preview, mapping, the "apply to every contact"
 * knobs, duplicate handling and a result that counts every outcome separately.
 */

/** One limit, one place (Reference's modal said 5 MB while the server allowed 50). */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 200_000;
/** At or under this many data rows the import runs inside the request; above it, as a background job. */
export const IMPORT_SYNC_MAX_ROWS = 1000;
/** Rejected rows kept for the downloadable report; the rest are only counted. */
export const IMPORT_REJECTS_MAX = 1000;

export const IMPORT_FIELDS = [
  'name',
  'firstName',
  'lastName',
  'phone',
  'email',
  'countryCode',
  'group',
  'tags',
  'language',
  'title',
  'address',
  'memo',
  'status',
  'source',
  // BL-193: the contact's IANA time zone (`Asia/Kolkata`); a zone the file gives never replaces one a person chose.
  'timezone',
  'consent',
  // BL-170: a file may carry a consent column per channel. `consent` stays the WhatsApp one (and the one a file with no per-channel
  // column is judged by); these two are read only when mapped, and grant only a row that says yes.
  'consentSms',
  'consentEmail',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const importFieldSchema = z.enum(IMPORT_FIELDS);

/**
 * Header text after normalisation (lowercase, only a-z and 0-9, so "Phone
 * Number", "phone_number" and "PHONE-NUMBER" are all `phonenumber`) matched
 * against these lists. Reference's lists plus the fields it could not import.
 */
export const IMPORT_ALIASES: Record<ImportField, readonly string[]> = {
  name: ['name', 'fullname', 'contactname', 'customername', 'displayname'],
  lastName: ['lastname', 'surname', 'familyname'],
  phone: [
    'mobile',
    'phone',
    'phonenumber',
    'whatsapp',
    'whatsappnumber',
    'number',
    'tel',
    'telephone',
    'cell',
    'cellphone',
    'msisdn',
    'mobilenumber',
  ],
  email: ['email', 'emailaddress', 'mail'],
  countryCode: ['countrycode', 'cc', 'dialcode', 'callingcode'],
  group: ['group', 'groups', 'contactgroup', 'list', 'lists'],
  language: ['language', 'lang', 'locale'],
  firstName: ['firstname', 'givenname', 'forename'],
  tags: ['tag', 'tags', 'labels'],
  title: ['title', 'salutation'],
  address: ['address', 'street', 'streetaddress'],
  memo: ['memo', 'note', 'notes', 'comment', 'comments'],
  status: ['status'],
  source: ['source'],
  timezone: ['timezone', 'tz', 'timezonename', 'iana', 'ianatimezone', 'contacttimezone'],
  /** Marketing consent per row (yes / no). Applied only when the person importing ticks the consent confirmation. */
  consent: [
    'consent',
    'optin',
    'optedin',
    'marketingconsent',
    'whatsappconsent',
    'whatsappoptin',
    'subscribed',
    'marketingoptin',
  ],
  /** SMS marketing consent per row (yes / no). Granted only when the importer ticks the confirmation and the row says yes. */
  consentSms: [
    'smsconsent',
    'smsoptin',
    'smsoptedin',
    'smssubscribed',
    'textconsent',
    'textoptin',
    'marketingsmsconsent',
    'smsmarketingconsent',
  ],
  /** Email marketing consent per row (yes / no). Granted only with the confirmation, a yes, and an email address on the row. */
  consentEmail: [
    'emailconsent',
    'emailoptin',
    'emailoptedin',
    'emailsubscribed',
    'marketingemailconsent',
    'emailmarketingconsent',
  ],
};

/** Scan order: the leftmost column wins a field, and a field takes one column. */
const DETECTION_ORDER: readonly ImportField[] = [
  'name',
  'lastName',
  'phone',
  'email',
  'countryCode',
  'group',
  'language',
  'firstName',
  'tags',
  'title',
  'address',
  'memo',
  'status',
  'source',
  'timezone',
  'consent',
  'consentSms',
  'consentEmail',
];

export function normalizeImportHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type ImportMapping = Partial<Record<ImportField, number | null>>;

/** Field -> column index for what could be recognised. Columns nothing matches are ignored. */
export function detectImportColumns(headers: readonly string[]): Record<string, number> {
  const detected: Record<string, number> = {};
  headers.forEach((header, index) => {
    const key = normalizeImportHeader(header);
    if (!key) return;
    const field = DETECTION_ORDER.find(
      (f) => detected[f] === undefined && IMPORT_ALIASES[f].includes(key),
    );
    if (field) detected[field] = index;
  });
  return detected;
}

/** The sample file is built from the importer's own header names so it can never drift from them. */
export const IMPORT_SAMPLE_HEADERS = [
  'name',
  'last_name',
  'country_code',
  'mobile',
  'email',
  'group',
  'language',
] as const;
export const IMPORT_SAMPLE_ROWS: readonly (readonly string[])[] = [
  ['Aarav Sharma', 'Sharma', '91', '9812345678', 'aarav@example.com', 'VIP, New leads', 'en'],
  ['Priya Patel', 'Patel', '91', '9898765432', 'priya@example.com', 'Customers', 'en'],
];

// --- consent column ----------------------------------------------------------------------

/** What one cell of the consent column means. `blank` is not granted and is not counted as a surprise; `unrecognised` is not granted. */
export type ImportConsentValue = 'granted' | 'not_granted' | 'unrecognised' | 'blank';

const CONSENT_YES = new Set([
  'yes',
  'y',
  'true',
  't',
  '1',
  'granted',
  'consent',
  'consented',
  'agreed',
  'accept',
  'accepted',
  'optin',
  'optedin',
  'subscribed',
  'subscribe',
  'ok',
  'نعم',
  'اجل',
  'موافق',
  'si',
  'oui',
  'ja',
  'sim',
  'да',
  'はい',
  '是',
  '예',
  'evet',
  'ya',
  'हाँ',
  'हां',
]);
const CONSENT_NO = new Set([
  'no',
  'n',
  'false',
  'f',
  '0',
  'notgranted',
  'withdrawn',
  'declined',
  'refused',
  'rejected',
  'optout',
  'optedout',
  'unsubscribed',
  'unsubscribe',
  'none',
  'null',
  'لا',
  'غيرموافق',
  'non',
  'nein',
  'nao',
  'нет',
  'いいえ',
  '否',
  '아니요',
  'hayir',
  'tidak',
  'नहीं',
]);

/** Yes / no spellings of a consent cell: case, spaces, hyphens and accents do not matter. Anything else is `unrecognised` (not granted). */
export function parseImportConsent(cell: string): ImportConsentValue {
  const raw = cell.trim();
  if (raw === '') return 'blank';
  const key = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_\-.!]+/g, '');
  if (CONSENT_YES.has(key)) return 'granted';
  if (CONSENT_NO.has(key)) return 'not_granted';
  return 'unrecognised';
}

// --- request -----------------------------------------------------------------------------

export const contactImportOptionsSchema = z.object({
  /** Field -> column index. Omitted: auto-detected from the header row. null: ignore that field. */
  mapping: z.record(importFieldSchema, z.number().int().min(0).nullable()).optional(),
  /** Omitted: detected from the header row (comma, semicolon, tab, pipe). */
  delimiter: z.enum([',', ';', '\t', '|']).optional(),
  /** Stamped on every contact this file CREATES. Existing contacts keep theirs. */
  status: z.string().trim().max(64).optional(),
  source: z.string().trim().max(128).optional(),
  /** Every contact in the file, new or updated, joins this group. */
  groupId: uuidSchema.optional(),
  /** Every contact in the file, new or updated, gets these tags (Reference accepted and ignored them). */
  tagIds: z.array(uuidSchema).max(50).optional(),
  /** For numbers with no country code of their own: "+91". */
  defaultCountryCode: z.string().trim().max(8).optional(),
  /**
   * Also emit contact.created / group / tag events for every row so flows and
   * webhooks fire. Off by default, as in Reference, where an import never triggers
   * automations; on, it is the caller's explicit choice.
   */
  triggerAutomations: queryBoolean().default(false),
  /**
   * The person importing confirms "I have consent to message these contacts". Every contact in the file then gets a `granted`
   * marketing event in the consent ledger (source `import`, the file name as evidence). With a column mapped to `consent`, only the
   * rows that say yes get one (a no, a blank or an unknown word records nothing). Off by default: an import without the
   * confirmation records NO consent (the column is ignored), and a contact that opted out is never turned back on by a file.
   */
  consentConfirmed: queryBoolean().default(false),
  /**
   * BL-170: the notice the file's contacts agreed under, as the importer states it ("Opted in at the store checkout, privacy notice v3").
   * Kept on every grant of this file as the wording and its version, beside the file name and the time, so the proof says what they
   * agreed to and not only that someone confirmed it. Optional; without it the grant says only that the importer confirmed consent.
   */
  consentNoticeText: z.string().trim().max(2000).optional(),
  consentNoticeVersion: z.string().trim().max(64).optional(),
});
export type ContactImportOptions = z.infer<typeof contactImportOptionsSchema>;

// --- preview -----------------------------------------------------------------------------

export const importRowIssueSchema = z.object({
  /** 1-based line in the file, header included. */
  row: z.number().int(),
  reason: z.string(),
  values: z.record(z.string()).optional(),
});
export type ImportRowIssue = z.infer<typeof importRowIssueSchema>;

/** The machine reasons a row can be rejected for; the web app translates them. */
export const IMPORT_REJECT_REASONS = [
  'missing_name',
  'missing_phone',
  'invalid_phone',
  'invalid_email',
  'invalid_timezone',
  'group_name_too_long',
  'tag_name_too_long',
  'plan_limit_reached',
  'tag_limit_reached',
  /** Not an error: the row repeats a number from earlier in the file and was merged into that contact. */
  'duplicate_in_file',
] as const;
export type ImportRejectReason = (typeof IMPORT_REJECT_REASONS)[number];

export const importQuotaSchema = z.object({
  /** 0 = unlimited. */
  limit: z.number().int(),
  used: z.number().int(),
  /** null = unlimited. */
  remaining: z.number().int().nullable(),
});

const importConsentSummarySchema = z.object({
  granted: z.number().int(),
  notGranted: z.number().int(),
  unrecognised: z.number().int(),
  /** Up to 5 values that are not yes or no, as written. */
  unrecognisedSamples: z.array(z.string()),
});

export const contactImportPreviewSchema = z.object({
  fileName: z.string(),
  delimiter: z.string(),
  headers: z.array(z.string()),
  detected: z.record(z.number().int()),
  /** The mapping that would be used (detected, overridden by the request). */
  mapping: z.record(z.number().int().nullable()),
  missingRequired: z.array(importFieldSchema),
  /** Up to 5 data rows, keyed by header. */
  sampleRows: z.array(z.record(z.string())),
  totals: z.object({
    rows: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    /** Rows repeating a number that appears earlier in the file. */
    duplicateInFile: z.number().int(),
    willCreate: z.number().int(),
    willUpdate: z.number().int(),
  }),
  invalidSamples: z.array(importRowIssueSchema),
  /** Group and tag names the file mentions that do not exist yet. */
  newGroups: z.array(z.string()),
  newTags: z.array(z.string()),
  quota: importQuotaSchema,
  /** Larger than the synchronous limit: the import will run as a background job. */
  runsAsJob: z.boolean(),
  /**
   * What the consent column says, per valid row, when one is mapped (null: no column, so the confirmation covers every contact).
   * `unrecognised` rows are shown so the person can fix the file; they are treated as not granted.
   */
  consent: importConsentSummarySchema.nullable().optional(),
  /** The same counts for the SMS and email consent columns, when mapped (BL-170). */
  consentSms: importConsentSummarySchema.nullable().optional(),
  consentEmail: importConsentSummarySchema.nullable().optional(),
});
export type ContactImportPreview = z.infer<typeof contactImportPreviewSchema>;

// --- job ---------------------------------------------------------------------------------

export const importJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

export const contactImportJobSchema = z.object({
  id: uuidSchema,
  status: importJobStatusSchema,
  fileName: z.string(),
  totalRows: z.number().int(),
  processedRows: z.number().int(),
  /** Result, each outcome counted on its own. */
  created: z.number().int(),
  updated: z.number().int(),
  invalid: z.number().int(),
  duplicatesInFile: z.number().int(),
  /** New contacts the plan's contact limit stopped. */
  limitExceeded: z.number().int(),
  error: z.string().nullable(),
  /** Who started the import; null for a deleted user. */
  createdBy: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ContactImportJob = z.infer<typeof contactImportJobSchema>;

export const listImportJobsQuerySchema = paginationQuerySchema;
export type ListImportJobsQuery = z.infer<typeof listImportJobsQuerySchema>;

/** Past exports of contacts: who, when and how many from the audit trail, plus the saved file while it is still kept. */
/** How long a saved export stays downloadable. */
export const EXPORT_KEEP_DAYS = 30;

export const exportHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ExportHistoryQuery = z.infer<typeof exportHistoryQuerySchema>;

export const exportHistoryItemSchema = z.object({
  at: z.string().datetime(),
  /** Who exported; null for a deleted user or a system actor. */
  by: z.string().nullable(),
  rows: z.number().int(),
  /** `ids`: the rows ticked; `filter`: everything the filter matched ("select all N matching" or Export all). */
  selection: z.enum(['ids', 'filter']),
  /** The saved file's id while it can still be downloaded (30 days, and only for exports made since files were kept). */
  fileId: z.string().uuid().nullable(),
  fileBytes: z.number().int().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type ExportHistoryItem = z.infer<typeof exportHistoryItemSchema>;

export const exportHistoryResponseSchema = z.object({ data: z.array(exportHistoryItemSchema) });
export type ExportHistoryResponse = z.infer<typeof exportHistoryResponseSchema>;

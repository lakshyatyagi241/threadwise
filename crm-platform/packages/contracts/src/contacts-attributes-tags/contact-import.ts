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
   * marketing event in the consent ledger (source `import`, the file name as evidence). Off by default: an import without the
   * confirmation records NO consent, and a contact that opted out is never turned back on by a file.
   */
  consentConfirmed: queryBoolean().default(false),
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
  'group_name_too_long',
  'tag_name_too_long',
  'plan_limit_reached',
  'tag_limit_reached',
] as const;
export type ImportRejectReason = (typeof IMPORT_REJECT_REASONS)[number];

export const importQuotaSchema = z.object({
  /** 0 = unlimited. */
  limit: z.number().int(),
  used: z.number().int(),
  /** null = unlimited. */
  remaining: z.number().int().nullable(),
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
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ContactImportJob = z.infer<typeof contactImportJobSchema>;

export const listImportJobsQuerySchema = paginationQuerySchema;
export type ListImportJobsQuery = z.infer<typeof listImportJobsQuerySchema>;

/** Past exports of contacts (the audit trail keeps who, when and how many; the file itself is not kept). */
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
});
export type ExportHistoryItem = z.infer<typeof exportHistoryItemSchema>;

export const exportHistoryResponseSchema = z.object({ data: z.array(exportHistoryItemSchema) });
export type ExportHistoryResponse = z.infer<typeof exportHistoryResponseSchema>;

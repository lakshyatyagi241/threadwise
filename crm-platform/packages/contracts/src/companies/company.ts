import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { moneyTotalSchema } from '../deals-pipelines/money';

/**
 * Companies (TW-CTP-001..). The B2B layer over contacts and deals: a company groups the contacts that work there and the deals
 * sold to it. Reference's website is `website` here too (stored in `domain`); it is free text, not a URL.
 */
export const COMPANY_NAME_MAX = 191;
export const COMPANY_EMAIL_MAX = 191;
export const COMPANY_PHONE_MAX = 32;
export const COMPANY_WEBSITE_MAX = 191;
export const COMPANY_INDUSTRY_MAX = 100;
export const COMPANY_SIZE_RANGE_MAX = 40;
export const COMPANY_ADDRESS_MAX = 500;
export const COMPANY_NOTES_MAX = 2000;
export const COMPANY_CUSTOM_TEXT_MAX = 4000;
export const COMPANY_CUSTOM_LIST_MAX = 100;
export const COMPANY_BULK_MAX = 100;
export const COMPANY_LINK_MAX = 100;

export const COMPANY_SORTS = ['created', 'name'] as const;
export const companySortSchema = z.enum(COMPANY_SORTS);
export type CompanySort = z.infer<typeof companySortSchema>;

export const companyUserRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type CompanyUserRef = z.infer<typeof companyUserRefSchema>;

/**
 * What a company is worth to the workspace, computed in the database over every linked record (Reference summed the rows it had
 * loaded, capped at 200, and added raw minor units of different currencies into one figure). `null` when the caller may not read
 * that kind of record (contacts need record.contacts.read, deals need record.deals.read).
 */
export const companyDealRollupSchema = z.object({
  total: z.number().int(),
  open: z.number().int(),
  won: z.number().int(),
  /** Per currency, never mixed. */
  openValue: z.array(moneyTotalSchema),
  wonValue: z.array(moneyTotalSchema),
});
export type CompanyDealRollup = z.infer<typeof companyDealRollupSchema>;

export const companyRollupSchema = z.object({
  contacts: z.number().int().nullable(),
  deals: companyDealRollupSchema.nullable(),
});
export type CompanyRollup = z.infer<typeof companyRollupSchema>;

/**
 * A value of one of the workspace's company properties (Settings, Company properties), as stored in the company's `data`: text for
 * the text-like types and dates, a number, a boolean (checkbox), or a list of option values (multi-select). `null` clears a key.
 */
export const companyCustomValueSchema = z.union([
  z.string().max(COMPANY_CUSTOM_TEXT_MAX),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(COMPANY_CUSTOM_TEXT_MAX)).max(COMPANY_CUSTOM_LIST_MAX),
  z.null(),
]);
export type CompanyCustomValue = z.infer<typeof companyCustomValueSchema>;
export const companyCustomFieldsSchema = z.record(
  z.string().min(1).max(100),
  companyCustomValueSchema,
);
export type CompanyCustomFields = z.infer<typeof companyCustomFieldsSchema>;

export const companyResponseSchema = z.object({
  id: uuidSchema,
  displayId: z.string().nullable(),
  name: z.string(),
  website: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  industry: z.string().nullable(),
  sizeRange: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  /** The values of the workspace's company properties, by property key; a key with no value is absent. */
  customFields: z.record(z.unknown()),
  owner: companyUserRefSchema.nullable(),
  createdBy: companyUserRefSchema.nullable(),
  rollup: companyRollupSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CompanyResponse = z.infer<typeof companyResponseSchema>;

export const companyPageResponseSchema = z.object({
  data: z.array(companyResponseSchema),
  page: pageInfoSchema,
});
export type CompanyPageResponse = z.infer<typeof companyPageResponseSchema>;

/**
 * A text field as a form sends it: trimmed, and an empty string means "nothing" (Reference's input middleware turned "" into null,
 * which is how a field was cleared). Absent keeps the stored value on update.
 */
const text = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
      z.string().max(max).nullable(),
    )
    .optional();

const emailText = z
  .preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
    z.string().email().max(COMPANY_EMAIL_MAX).nullable(),
  )
  .optional();

const name = z.string().trim().min(1).max(COMPANY_NAME_MAX);

export const createCompanySchema = z.object({
  name,
  email: emailText,
  phone: text(COMPANY_PHONE_MAX),
  website: text(COMPANY_WEBSITE_MAX),
  industry: text(COMPANY_INDUSTRY_MAX),
  sizeRange: text(COMPANY_SIZE_RANGE_MAX),
  address: text(COMPANY_ADDRESS_MAX),
  notes: text(COMPANY_NOTES_MAX),
  /** Values of the workspace's company properties, by key. Only editable properties; a blank or `null` value stores nothing. */
  customFields: companyCustomFieldsSchema.optional(),
  /** An active member of this workspace. Omit for the caller; `null` for nobody. */
  ownerId: uuidSchema.nullish(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Absent keeps, `null` (or an empty string) clears a field that can be empty; the name cannot be cleared. */
export const updateCompanySchema = z.object({
  name: name.optional(),
  email: emailText,
  phone: text(COMPANY_PHONE_MAX),
  website: text(COMPANY_WEBSITE_MAX),
  industry: text(COMPANY_INDUSTRY_MAX),
  sizeRange: text(COMPANY_SIZE_RANGE_MAX),
  address: text(COMPANY_ADDRESS_MAX),
  notes: text(COMPANY_NOTES_MAX),
  /** Merged into the stored values: a key sent changes, `null` or a blank clears it, a key left out keeps its value. */
  customFields: companyCustomFieldsSchema.optional(),
  ownerId: uuidSchema.nullish(),
  /** Optimistic lock. Send the value you read; a mismatch returns 409 ROW_VERSION_CONFLICT. */
  rowVersion: z.number().int().positive(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/** The filters a list and the stats share. */
const companyFilterShape = {
  /** Case-insensitive substring of the name (the only field Reference searched). */
  q: z.string().trim().min(1).max(100).optional(),
  ownerId: uuidSchema.optional(),
  /** Companies with no owner. Not together with `ownerId`. */
  unassigned: queryBoolean().optional(),
  /** Exactly this industry (compared case-insensitively). */
  industry: z.string().trim().min(1).max(COMPANY_INDUSTRY_MAX).optional(),
  /** Only companies with at least one open deal (Reference's "With open deals" tile). */
  hasOpenDeals: queryBoolean().optional(),
};

const refineOwner = <T extends { ownerId?: string; unassigned?: boolean }>(q: T) =>
  !(q.ownerId && q.unassigned);
const ownerMessage = { message: 'ownerId and unassigned cannot be combined', path: ['unassigned'] };

export const listCompaniesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(512).optional(),
    /** `created` (newest first, Reference's order; default) or `name` (A to Z). */
    sort: companySortSchema.default('created'),
    ...companyFilterShape,
  })
  .refine(refineOwner, ownerMessage);
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;

export const companyStatsQuerySchema = z
  .object(companyFilterShape)
  .refine(refineOwner, ownerMessage);
export type CompanyStatsQuery = z.infer<typeof companyStatsQuerySchema>;

/** The three tiles over the list: how many companies match, how many have an open deal, what they won. Same filters as the list. */
export const companyStatsResponseSchema = z.object({
  total: z.number().int(),
  /** `null` when the caller may not read deals. */
  withOpenDeals: z.number().int().nullable(),
  wonValue: z.array(moneyTotalSchema).nullable(),
});
export type CompanyStatsResponse = z.infer<typeof companyStatsResponseSchema>;

/** The distinct industries typed so far, for the industry filter. */
export const companyIndustriesResponseSchema = z.object({ data: z.array(z.string()) });
export type CompanyIndustriesResponse = z.infer<typeof companyIndustriesResponseSchema>;

/** A row of a picker (Reference's `GET companies/search`): never the full record. */
export const companySelectItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  industry: z.string().nullable(),
});
export type CompanySelectItem = z.infer<typeof companySelectItemSchema>;

export const companySelectQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CompanySelectQuery = z.infer<typeof companySelectQuerySchema>;

// --- contacts of a company -----------------------------------------------------------------------------------------------------

export const companyContactSchema = z.object({
  id: uuidSchema,
  /** Reference showed "(no name)" for a contact without one; the screen does that, the API says `null`. */
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type CompanyContact = z.infer<typeof companyContactSchema>;

export const companyContactsPageSchema = z.object({
  data: z.array(companyContactSchema),
  page: pageInfoSchema,
});
export type CompanyContactsPage = z.infer<typeof companyContactsPageSchema>;

export const listCompanyContactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListCompanyContactsQuery = z.infer<typeof listCompanyContactsQuerySchema>;

/** Put existing contacts under the company (each moves from its old company, if it had one). */
export const linkCompanyContactsSchema = z.object({
  contactIds: z.array(uuidSchema).min(1).max(COMPANY_LINK_MAX),
});
export type LinkCompanyContactsInput = z.infer<typeof linkCompanyContactsSchema>;

export const bulkCompanyIdsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(COMPANY_BULK_MAX),
});
export type BulkCompanyIdsInput = z.infer<typeof bulkCompanyIdsSchema>;

/** One bad id must not sink the others: the rest succeed and the failures say why. */
export const companyBulkResultSchema = z.object({
  succeeded: z.array(uuidSchema),
  failed: z.array(z.object({ id: uuidSchema, code: z.string(), message: z.string() })),
});
export type CompanyBulkResult = z.infer<typeof companyBulkResultSchema>;

// --- activity --------------------------------------------------------------------------------------------------------------------

/** One changed field of one entry; for a contact link `field` is `contactLinked` / `contactUnlinked` and the value is the contact. */
export const companyActivityChangeSchema = z.object({
  field: z.string(),
  old: z.unknown(),
  new: z.unknown(),
});

export const companyActivityEntrySchema = z.object({
  action: z.enum(['insert', 'update', 'delete']),
  actor: companyUserRefSchema.nullable(),
  at: z.string().datetime(),
  changes: z.array(companyActivityChangeSchema),
});
export type CompanyActivityEntry = z.infer<typeof companyActivityEntrySchema>;

export const companyActivityPageSchema = z.object({
  data: z.array(companyActivityEntrySchema),
  page: pageInfoSchema,
});
export type CompanyActivityPage = z.infer<typeof companyActivityPageSchema>;

export const listCompanyActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListCompanyActivityQuery = z.infer<typeof listCompanyActivityQuerySchema>;

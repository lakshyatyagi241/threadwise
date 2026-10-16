import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { httpsUrlSchema } from '../forms-builder/definition';
import { complianceClockSchema, complianceRegimeSchema, dndRegistrySchema } from './regimes';

/**
 * The Compliance center's settings document (BL-172): one row per workspace. Read with `GET /v2/compliance/settings`, saved whole with
 * `PATCH` and the `rowVersion` that was read (absent on the first save), the way the consent settings are.
 */

/** A link that may be empty. https only: a `javascript:` or `data:` address never reaches a page. */
const optionalHttpsUrl = z
  .union([httpsUrlSchema, z.literal(''), z.null()])
  .transform((v) => (v ? v : null));

const text = (max: number) => z.string().trim().max(max);
const emailOrEmpty = z.union([z.literal(''), z.string().trim().max(200).email()]);

/** The person a regulator or a data subject can reach: a data protection officer, a privacy contact, a grievance officer. */
export const officerContactSchema = z.object({
  name: text(120),
  email: emailOrEmpty,
  phone: text(40),
  address: text(300),
});
export type OfficerContact = z.infer<typeof officerContactSchema>;

export const EMPTY_OFFICER: OfficerContact = { name: '', email: '', phone: '', address: '' };

export const CHILDREN_POLICIES = ['unset', 'no_minors', 'may_include_minors'] as const;
export const childrenPolicySchema = z.enum(CHILDREN_POLICIES);
export type ChildrenPolicy = z.infer<typeof childrenPolicySchema>;

/** ISO 639-1/-2 style language code of the second notice (`hi`, `bn`, `ta`...). English is always the first. */
export const complianceNoticeLocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'Use a language code such as hi or ta.');

/** The languages offered for the second DPDP notice (India's scheduled languages that the product's picker lists). */
export const INDIAN_NOTICE_LOCALES = [
  'hi',
  'bn',
  'ta',
  'te',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
  'ur',
] as const;

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: complianceClockSchema,
  end: complianceClockSchema,
});
export type QuietHours = z.infer<typeof quietHoursSchema>;

export const callingWindowSchema = z.object({
  enabled: z.boolean(),
  start: complianceClockSchema,
  end: complianceClockSchema,
  /** ISO weekdays, 1 Monday to 7 Sunday. */
  days: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
});
export type CallingWindow = z.infer<typeof callingWindowSchema>;

const settingsFields = {
  /** The profiles switched on. Empty until a person confirms a choice. */
  regimes: z
    .array(complianceRegimeSchema)
    .max(9)
    .transform((r) => [...new Set(r)]),
  privacyUrl: optionalHttpsUrl,
  termsUrl: optionalHttpsUrl,
  /** Data protection officer or privacy contact (GDPR, UK GDPR, LGPD, PDPA). */
  dpo: officerContactSchema,
  /** Grievance officer (DPDP Act, India). */
  grievanceOfficer: officerContactSchema,
  childrenPolicy: childrenPolicySchema,
  /** DPDP: a verifiable parent or guardian consent is collected for minors. A flag; the evidence is BL-180. */
  parentalConsentRequired: z.boolean(),
  /** CCPA: offer a "Do Not Sell or Share My Personal Information" opt-out. */
  offerSaleShareOptOut: z.boolean(),
  optOutNoticeUrl: optionalHttpsUrl,
  /** DPDP consent manager: a name, a link and the registration number; nothing is integrated (BL-181, BL-222). */
  consentManager: z.object({
    name: text(120),
    url: optionalHttpsUrl,
    /** The Consent Manager's registration number (BL-181): a note. The inbound hook is a contract only (BL-222). */
    registrationId: text(60),
  }),
  quietHours: quietHoursSchema,
  callingWindow: callingWindowSchema,
  /** IANA zone the quiet hours and calling window are read in; null = the workspace's. */
  windowTimezone: z.string().trim().max(64).nullable(),
  dndRegistry: dndRegistrySchema,
  /** The language of the second workspace notice (DPDP asks for English plus an Indian language). */
  secondaryNoticeLocale: complianceNoticeLocaleSchema.nullable(),
  /** Show the sub-processor list on the public page `/trust/<workspace>`. */
  subprocessorsPublic: z.boolean(),
};

export const complianceSettingsValuesSchema = z.object(settingsFields);
export type ComplianceSettingsValues = z.infer<typeof complianceSettingsValuesSchema>;

export const updateComplianceSettingsSchema = z.object({
  ...settingsFields,
  /** The version that was read; absent on the first save. */
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateComplianceSettingsInput = z.infer<typeof updateComplianceSettingsSchema>;

export const COMPLIANCE_DEFAULTS: ComplianceSettingsValues = {
  regimes: [],
  privacyUrl: null,
  termsUrl: null,
  dpo: EMPTY_OFFICER,
  grievanceOfficer: EMPTY_OFFICER,
  childrenPolicy: 'unset',
  parentalConsentRequired: false,
  offerSaleShareOptOut: false,
  optOutNoticeUrl: null,
  consentManager: { name: '', url: null, registrationId: '' },
  quietHours: { enabled: false, start: '21:00', end: '08:00' },
  callingWindow: { enabled: false, start: '08:00', end: '21:00', days: [1, 2, 3, 4, 5, 6, 7] },
  windowTimezone: null,
  dndRegistry: 'none',
  secondaryNoticeLocale: null,
  subprocessorsPublic: false,
};

/** Where the country that suggested the profiles came from. */
export const SUGGESTION_SOURCES = ['billing', 'onboarding'] as const;

export const complianceSettingsSchema = complianceSettingsValuesSchema.extend({
  /** Null until the first save. */
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
  /** When a person last confirmed the profile choice; null = never confirmed (the profiles shown are only the suggestion). */
  regimesConfirmedAt: z.string().nullable(),
  /** The profiles the workspace's country suggests, and where the country came from. Never applied by itself. */
  suggestion: z.object({
    country: z.string().nullable(),
    source: z.enum(SUGGESTION_SOURCES).nullable(),
    regimes: z.array(complianceRegimeSchema),
  }),
  /** The workspace time zone (onboarding), the default for the quiet hours and the calling window. */
  workspaceTimezone: z.string().nullable(),
});
export type ComplianceSettings = z.infer<typeof complianceSettingsSchema>;

/** What the form builder and the consent-notice editor offer: the workspace's links and its default notice wording. */
export const complianceLinksSchema = z.object({
  privacyUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  /** The current English default notice, when enabled. */
  noticeText: z.string().nullable(),
});
export type ComplianceLinks = z.infer<typeof complianceLinksSchema>;

// ---- sub-processors -------------------------------------------------------------------------------------------------------------

export const SUBPROCESSOR_STATUSES = ['active', 'planned', 'removed'] as const;
export const subprocessorStatusSchema = z.enum(SUBPROCESSOR_STATUSES);
export type SubprocessorStatus = z.infer<typeof subprocessorStatusSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const subprocessorInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: text(300),
  dataCategories: text(300),
  /** Country or region where the vendor processes the data. */
  location: text(120),
  websiteUrl: optionalHttpsUrl,
  dpaUrl: optionalHttpsUrl,
  status: subprocessorStatusSchema,
  /** The day the vendor was added, and the day customers were told. */
  addedOn: isoDate.nullable(),
  noticeSentOn: isoDate.nullable(),
});
export type SubprocessorInput = z.infer<typeof subprocessorInputSchema>;

export const updateSubprocessorSchema = subprocessorInputSchema.extend({
  rowVersion: z.number().int().positive(),
});
export type UpdateSubprocessorInput = z.infer<typeof updateSubprocessorSchema>;

export const subprocessorSchema = subprocessorInputSchema.extend({
  id: uuidSchema,
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Subprocessor = z.infer<typeof subprocessorSchema>;

export const subprocessorListSchema = z.object({ data: z.array(subprocessorSchema) });
export type SubprocessorList = z.infer<typeof subprocessorListSchema>;

/** What the public page shows: only active vendors, no ids, and only when the workspace switched the page on. */
export const publicTrustPageSchema = z.object({
  workspaceName: z.string(),
  privacyUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  dpoName: z.string(),
  dpoEmail: z.string(),
  subprocessors: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      dataCategories: z.string(),
      location: z.string(),
      websiteUrl: z.string().nullable(),
    }),
  ),
});
export type PublicTrustPage = z.infer<typeof publicTrustPageSchema>;

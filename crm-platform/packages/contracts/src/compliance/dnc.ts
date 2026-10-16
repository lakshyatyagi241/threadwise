import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';

/**
 * The workspace's Do-Not-Call list (BL-181, spec docs/specs/privacy-and-data-governance.md section 11.11): numbers that must not get
 * MARKETING by voice or SMS. The ConsentGate reads it (reason `on_dnc_list`). Managed in the Compliance center with
 * `settings.compliance.manage`; read with `settings.compliance.read`. No registry (NDNC, the US national list, Singapore's) is called
 * from here: a workspace loads the extract it is entitled to download (source `registry_export`).
 */

export const DNC_SOURCES = ['manual', 'import', 'contact_request', 'registry_export'] as const;
export const dncSourceSchema = z.enum(DNC_SOURCES);
export type DncSource = z.infer<typeof dncSourceSchema>;

/** Most numbers one request adds; a longer file is cut into requests by the screen. */
export const DNC_ADD_MAX = 1000;
/**
 * The largest CSV text one import request takes. The platform's JSON body limit is 100 KiB, so this stays under it; the screen cuts a
 * bigger file into requests of this size (the header kept on each) and adds up the answers.
 */
export const DNC_IMPORT_MAX_BYTES = 90 * 1024;
export const DNC_NOTE_MAX = 300;

export const dncEntrySchema = z.object({
  id: uuidSchema,
  /** E.164 with its plus. */
  phone: z.string(),
  source: dncSourceSchema,
  note: z.string().nullable(),
  addedBy: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  createdAt: z.string().datetime(),
});
export type DncEntry = z.infer<typeof dncEntrySchema>;

export const dncListQuerySchema = z.object({
  /** Digits of the number to look for (a part of it is enough). */
  q: z.string().trim().max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DncListQuery = z.infer<typeof dncListQuerySchema>;

export const dncListSchema = z.object({
  data: z.array(dncEntrySchema),
  page: pageInfoSchema,
  /** How many numbers the workspace has listed. */
  total: z.number().int().min(0),
});
export type DncList = z.infer<typeof dncListSchema>;

/** Numbers typed or pasted, one per entry. Local numbers are read with `defaultCountryCode` (`+91`, `91`). */
export const addDncSchema = z.object({
  numbers: z.array(z.string().trim().min(1).max(40)).min(1).max(DNC_ADD_MAX),
  defaultCountryCode: z.string().trim().max(8).optional(),
  source: z.enum(['manual', 'contact_request']).default('manual'),
  note: z.string().trim().max(DNC_NOTE_MAX).optional(),
});
export type AddDncInput = z.infer<typeof addDncSchema>;

/** A CSV as text: the first column named phone / mobile / number (any case), else the first column. */
export const importDncSchema = z.object({
  csv: z.string().min(1).max(DNC_IMPORT_MAX_BYTES),
  defaultCountryCode: z.string().trim().max(8).optional(),
  source: z.enum(['import', 'registry_export']).default('import'),
  note: z.string().trim().max(DNC_NOTE_MAX).optional(),
});
export type ImportDncInput = z.infer<typeof importDncSchema>;

export const dncAddResultSchema = z.object({
  /** New entries. */
  added: z.number().int().min(0),
  /** Numbers that were already on the list (left as they were). */
  alreadyListed: z.number().int().min(0),
  /** Entries that are not a phone number. */
  invalid: z.number().int().min(0),
  /** The first few of them, as written, so the person can fix the list. */
  invalidSamples: z.array(z.string()).max(10),
});
export type DncAddResult = z.infer<typeof dncAddResultSchema>;

/**
 * The event a DPDP Consent Manager would send to a workspace (BL-181, spec 11.11): a CONTRACT only. No route serves it yet and no key
 * exists to sign it (BL-222); it is fixed here so a Consent Manager's integration, when there is a real specification to meet, has one
 * place to land. `eventId` makes it idempotent; `consentArtifactId` is the reference kept as evidence in the ledger.
 */
export const consentManagerEventSchema = z.object({
  eventId: z.string().min(1).max(100),
  occurredAt: z.string().datetime(),
  principal: z
    .object({ phone: z.string().max(40).optional(), email: z.string().email().max(200).optional() })
    .refine((p) => Boolean(p.phone || p.email), 'a phone number or an email address is required'),
  purpose: z.enum(['marketing', 'service']),
  channels: z
    .array(z.enum(['whatsapp', 'sms', 'email', 'voice']))
    .min(1)
    .max(4),
  action: z.enum(['granted', 'withdrawn']),
  consentArtifactId: z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});
export type ConsentManagerEvent = z.infer<typeof consentManagerEventSchema>;

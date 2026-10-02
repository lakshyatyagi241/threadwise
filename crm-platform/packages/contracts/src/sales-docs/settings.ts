import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { salesDocKindSchema, SALES_DOC_NOTES_MAX, SALES_DOC_TERMS_MAX } from './sales-doc';

/**
 * Numbering, defaults and templates of proposals and estimates (WD-PROP-008, D-06; templates: the "default terms and notes" of
 * WD-PROP-030). Capability `record.sales-docs.settings`.
 */

const prefix = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,10}$/, '1 to 10 letters or digits')
  .transform((v) => v.toUpperCase());

export const salesDocSettingsSchema = z.object({
  /** The number is `<prefix>-<counter padded to numberPadding>`: PRO-0001. */
  proposalPrefix: z.string(),
  estimatePrefix: z.string(),
  numberPadding: z.number().int(),
  /** The first counter value handed out; only effective until the first document of the kind exists. */
  proposalStart: z.number().int(),
  estimateStart: z.number().int(),
  /** A new document without a valid-until date gets today + this many days (null: no date). */
  defaultValidDays: z.number().int().nullable(),
  /** A public link stops working this many days after the document is first sent (null: it lives as long as the document is open). */
  linkTtlDays: z.number().int().nullable(),
  /** The counters' current values: the next number is last + 1. */
  proposalLast: z.number().int(),
  estimateLast: z.number().int(),
  /** Null until the first save (send no `rowVersion` then). */
  rowVersion: z.number().int().nullable(),
});
export type SalesDocSettings = z.infer<typeof salesDocSettingsSchema>;

export const updateSalesDocSettingsSchema = z.object({
  proposalPrefix: prefix.optional(),
  estimatePrefix: prefix.optional(),
  numberPadding: z.number().int().min(1).max(10).optional(),
  proposalStart: z.number().int().min(1).max(999_999_999).optional(),
  estimateStart: z.number().int().min(1).max(999_999_999).optional(),
  defaultValidDays: z.number().int().min(1).max(3650).nullish(),
  linkTtlDays: z.number().int().min(1).max(3650).nullish(),
  /** Absent on the first save. */
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateSalesDocSettingsInput = z.infer<typeof updateSalesDocSettingsSchema>;

export const salesDocTemplateSchema = z.object({
  id: uuidSchema,
  kind: salesDocKindSchema,
  name: z.string(),
  terms: z.string().nullable(),
  notes: z.string().nullable(),
  validDays: z.number().int().nullable(),
  /** The template a new document of this kind starts from. */
  isDefault: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SalesDocTemplate = z.infer<typeof salesDocTemplateSchema>;

export const createSalesDocTemplateSchema = z.object({
  kind: salesDocKindSchema,
  name: z.string().trim().min(1).max(120),
  terms: z.string().trim().max(SALES_DOC_TERMS_MAX).nullish(),
  notes: z.string().trim().max(SALES_DOC_NOTES_MAX).nullish(),
  validDays: z.number().int().min(1).max(3650).nullish(),
  /** Making a template the default clears the flag on the previous default of its kind. */
  isDefault: z.boolean().optional(),
});
export type CreateSalesDocTemplateInput = z.infer<typeof createSalesDocTemplateSchema>;

export const updateSalesDocTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  terms: z.string().trim().max(SALES_DOC_TERMS_MAX).nullish(),
  notes: z.string().trim().max(SALES_DOC_NOTES_MAX).nullish(),
  validDays: z.number().int().min(1).max(3650).nullish(),
  isDefault: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateSalesDocTemplateInput = z.infer<typeof updateSalesDocTemplateSchema>;

export const listSalesDocTemplatesQuerySchema = z.object({ kind: salesDocKindSchema.optional() });
export type ListSalesDocTemplatesQuery = z.infer<typeof listSalesDocTemplatesQuerySchema>;

import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** The five canonical legal documents (TW-CMS-013/033). Nothing else is routable under /legal. */
export const LEGAL_SLUGS = ['terms', 'privacy', 'refund', 'cookies', 'acceptable-use'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
export const isLegalSlug = (v: string): v is LegalSlug =>
  (LEGAL_SLUGS as readonly string[]).includes(v);

export const legalSectionSchema = z.object({
  /** Shown in the table of contents and used verbatim as the anchor id (`#sec-<n>`). */
  n: z.string().trim().max(12),
  title: z.string().trim().max(200),
  /** Sanitised HTML. */
  body: z.string().max(100_000),
});
export type LegalSection = z.infer<typeof legalSectionSchema>;

export const legalPageAdminSchema = z.object({
  id: uuidSchema,
  slug: z.enum(LEGAL_SLUGS),
  title: z.string(),
  subtitle: z.string().nullable(),
  updatedLabel: z.string().nullable(),
  effectiveLabel: z.string().nullable(),
  sections: z.array(legalSectionSchema),
  isPublished: z.boolean(),
  sort: z.number().int(),
  rowVersion: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type LegalPageAdmin = z.infer<typeof legalPageAdminSchema>;

export const legalPageListResponseSchema = z.object({ data: z.array(legalPageAdminSchema) });
export type LegalPageListResponse = z.infer<typeof legalPageListResponseSchema>;

export const updateLegalPageRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(1000).nullish(),
  updatedLabel: z.string().trim().max(120).nullish(),
  effectiveLabel: z.string().trim().max(120).nullish(),
  sections: z.array(legalSectionSchema).max(60),
  isPublished: z.boolean(),
  rowVersion: z.number().int().positive(),
});
export type UpdateLegalPageRequest = z.infer<typeof updateLegalPageRequestSchema>;

export const toggleLegalPageRequestSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type ToggleLegalPageRequest = z.infer<typeof toggleLegalPageRequestSchema>;

/** What a visitor's legal page needs. `readMinutes` follows Reference: max(1, floor(sections * 1.5)). */
export const legalPagePublicSchema = z.object({
  slug: z.enum(LEGAL_SLUGS),
  title: z.string(),
  subtitle: z.string().nullable(),
  updatedLabel: z.string().nullable(),
  effectiveLabel: z.string().nullable(),
  sections: z.array(legalSectionSchema),
  readMinutes: z.number().int().min(1),
});
export type LegalPagePublic = z.infer<typeof legalPagePublicSchema>;

export const legalPublicListResponseSchema = z.object({
  data: z.array(z.object({ slug: z.enum(LEGAL_SLUGS), title: z.string() })),
});
export type LegalPublicListResponse = z.infer<typeof legalPublicListResponseSchema>;

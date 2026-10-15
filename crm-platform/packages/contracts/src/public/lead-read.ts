import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { consentProofSchema } from '../contact-consent/intake';

/**
 * `/public/v1` — the external contract.
 *
 * Versioned and frozen independently of internal DTOs: an internal refactor
 * must never break a partner's integration. Authenticated by API key + HMAC
 * request signature, rate limited per key, and served exclusively from the
 * read replica.
 *
 * Scope is deliberately the minimum agreed in the requirements call:
 * name, email, mobile, lifecycle stage, college tag, last-updated.
 */
export const publicLeadReadSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  lifecycleStage: z.string().nullable(),
  collegeTag: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type PublicLeadRead = z.infer<typeof publicLeadReadSchema>;

export const publicLeadSubmitSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  mobile: z.string().min(6).max(20),
  source: z.string().max(100).default('partner_api'),
  collegeTag: z.string().max(200).optional(),
  /**
   * Free-form extras. Held as-is for the caller's own nomenclature (the
   * "13th parameter" from the requirements call) — the platform stores and
   * echoes these but never branches on them.
   */
  custom: z.record(z.string()).optional(),
  /**
   * Only when the person agreed to marketing messages on the caller's side: the wording they were shown (`text`, with its `version`)
   * or how they agreed (`note`), and optionally when (`at`). Without it the lead is stored with NO marketing consent. With it the
   * ledger gets a grant with source `api` and the API key as evidence.
   */
  consent: consentProofSchema.optional(),
});
export type PublicLeadSubmitInput = z.infer<typeof publicLeadSubmitSchema>;

export const publicLeadSubmitResponseSchema = z.object({
  id: uuidSchema,
  created: z.boolean().describe('false when an existing contact was matched and updated'),
});

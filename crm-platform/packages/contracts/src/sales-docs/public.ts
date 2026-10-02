import { z } from 'zod';
import { emailSchema } from '../common/ids';
import {
  salesDocDiscountSchema,
  salesDocKindSchema,
  salesDocLineSchema,
  salesDocStatusSchema,
  salesDocTotalsSchema,
} from './sales-doc';

/**
 * The buyer's side (TW-PROP-014..016, D-11, D-16). No login: the link token in the path is the only credential. Served under
 * `/v2/public/sales-docs/:token`, which answers 404 for an unknown token and 410 `SALESDOC_LINK_UNAVAILABLE` for a revoked or
 * expired link, always with `Cache-Control: no-store`, `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
 *
 * The page never shows the buyer's email or phone (Reference printed both to anyone holding the link), and never anything internal.
 */

export const publicSalesDocSchema = z.object({
  kind: salesDocKindSchema,
  number: z.string(),
  title: z.string().nullable(),
  /** The status as the buyer should read it: a document past its valid-until date is `expired` even before the sweep marks it. */
  status: salesDocStatusSchema,
  seller: z.object({ name: z.string() }),
  buyer: z.object({ name: z.string().nullable(), company: z.string().nullable() }),
  currency: z.string(),
  exponent: z.number().int(),
  taxRate: z.string(),
  discount: salesDocDiscountSchema.nullable(),
  lines: z.array(salesDocLineSchema),
  totals: salesDocTotalsSchema,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  validUntil: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  /** The buyer may accept or decline now: sent or viewed, not past its valid-until date, current revision. */
  canDecide: z.boolean(),
  /** Why not, when `canDecide` is false and the document is still open: `expired`. Null otherwise. */
  blockedReason: z.enum(['expired']).nullable(),
  decision: z
    .object({
      status: z.enum(['accepted', 'declined']),
      decidedAt: z.string().datetime(),
      signerName: z.string().nullable(),
    })
    .nullable(),
  revision: z.number().int(),
});
export type PublicSalesDoc = z.infer<typeof publicSalesDocSchema>;

/** A drawn signature as a PNG data URL, at most 60,000 characters (a signature pad is a few KB; the JSON body limit is 100 KB). */
export const SALES_DOC_SIGNATURE_MAX = 60_000;
export const signatureSchema = z
  .string()
  .max(SALES_DOC_SIGNATURE_MAX)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'a PNG data URL');

/** Accepting records who, from where and when (signer, IP, user agent are taken from the request) in the audit trail. */
export const publicAcceptSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  signerEmail: emailSchema.optional(),
  /** Optional drawn signature. */
  signature: signatureSchema.optional(),
  comment: z.string().trim().max(1000).optional(),
  /** The buyer confirms the scope and pricing shown. Must be `true`. */
  consent: z.literal(true),
});
export type PublicAcceptInput = z.infer<typeof publicAcceptSchema>;

export const publicDeclineSchema = z.object({
  signerName: z.string().trim().min(2).max(120).optional(),
  signerEmail: emailSchema.optional(),
  reason: z.string().trim().max(1000).optional(),
});
export type PublicDeclineInput = z.infer<typeof publicDeclineSchema>;

export const publicDecisionResponseSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  decidedAt: z.string().datetime(),
  /** The same call twice is the same answer: `true` when this call changed nothing because the decision was already recorded. */
  replay: z.boolean(),
});
export type PublicDecisionResponse = z.infer<typeof publicDecisionResponseSchema>;

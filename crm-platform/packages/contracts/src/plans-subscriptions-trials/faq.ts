import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Pricing FAQs (TW-PLAN-009). One table feeds the in-app plan picker (every active FAQ), the public pricing page
 * (`pricing` and `both`) and the homepage slider (`home` and `both`), so an operator edits them in one place.
 */
export const FAQ_PLACEMENTS = ['pricing', 'home', 'both'] as const;
export const faqPlacementSchema = z.enum(FAQ_PLACEMENTS);
export type FaqPlacement = z.infer<typeof faqPlacementSchema>;

const question = z.string().trim().min(1, 'Enter a question.').max(255);
const answer = z.string().trim().min(1, 'Enter an answer.').max(5000);
const sortOrder = z.number().int().min(0).max(9999);

/** No sort order = the current maximum plus one (TW-PLAN-009 rule 2). */
export const createPricingFaqRequestSchema = z.object({
  question,
  answer,
  sortOrder: sortOrder.nullable().optional(),
  placement: faqPlacementSchema.default('pricing'),
  isActive: z.boolean().default(true),
});
export type CreatePricingFaqRequest = z.input<typeof createPricingFaqRequestSchema>;

export const updatePricingFaqRequestSchema = z
  .object({
    question,
    answer,
    sortOrder,
    placement: faqPlacementSchema,
    isActive: z.boolean(),
    rowVersion: z.number().int().min(1),
  })
  .partial()
  .required({ rowVersion: true });
export type UpdatePricingFaqRequest = z.input<typeof updatePricingFaqRequestSchema>;

export const pricingFaqSchema = z.object({
  id: uuidSchema,
  question: z.string(),
  answer: z.string(),
  sortOrder: z.number().int(),
  placement: faqPlacementSchema,
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PricingFaq = z.infer<typeof pricingFaqSchema>;

export const pricingFaqListResponseSchema = z.object({ data: z.array(pricingFaqSchema) });
export type PricingFaqListResponse = z.infer<typeof pricingFaqListResponseSchema>;

/** What a reader gets: no ids of the operator's bookkeeping, only the words in order. */
export const publicFaqSchema = z.object({
  id: uuidSchema,
  question: z.string(),
  answer: z.string(),
});
export const publicFaqListResponseSchema = z.object({ data: z.array(publicFaqSchema) });
export type PublicFaqListResponse = z.infer<typeof publicFaqListResponseSchema>;

export const publicFaqQuerySchema = z.object({
  for: z.enum(['pricing', 'home']).default('pricing'),
});
export type PublicFaqQuery = z.infer<typeof publicFaqQuerySchema>;

import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';

/**
 * Sub-agent / channel-partner contracts.
 *
 * Context: sub-agents are external lead sources. They log into
 * their own portal, submit a lead, and then want to see that lead's stage
 * move. They are NOT staff — they never appear in the staff user table, never
 * get assigned a conversation, and can only ever see leads they submitted.
 */
export const partnerAgentResponseSchema = z.object({
  id: uuidSchema,
  code: z.string().describe('Short agent code shown as "Submitted by", e.g. AG-SHUBHAM'),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  createdAt: z.string().datetime(),
});
export type PartnerAgentResponse = z.infer<typeof partnerAgentResponseSchema>;

/** What a sub-agent fills in on their portal. Deliberately small. */
export const submitPartnerLeadSchema = z.object({
  name: z.string().min(1).max(255),
  email: emailSchema,
  phone: phoneSchema,
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  /** Which institute/college this lead is being put forward for. */
  collegeTag: z.string().max(200).optional(),
  programOfInterest: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type SubmitPartnerLeadInput = z.infer<typeof submitPartnerLeadSchema>;

/**
 * What the agent sees back.
 *
 * Note what is NOT here: no owner, no internal notes, no conversation history,
 * no other agent's leads. The agent portal stores only the id mapping locally;
 * `lifecycleStage` and `updatedAt` are read live from the read replica on every
 * view, so there is exactly one source of truth for stage.
 */
export const partnerLeadViewSchema = z.object({
  id: uuidSchema.describe('The mapped contact id in the CRM'),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  lifecycleStage: z.string().nullable(),
  collegeTag: z.string().nullable(),
  submittedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PartnerLeadView = z.infer<typeof partnerLeadViewSchema>;

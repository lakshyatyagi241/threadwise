/**
 * AI CRM Copilot (AICRM; Reference `/ai-crm`): a chat surface where an LLM runs the CRM by tool-calling.
 * See docs/threadwise-port/inventory/ai-copilot-lead-finder.md TW-AICRM-001..011, 015, 016.
 */
import { z } from 'zod';

export const AI_CRM_MESSAGE_MAX = 2000;

export const aiCrmMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(AI_CRM_MESSAGE_MAX),
});
export type AiCrmMessageInput = z.infer<typeof aiCrmMessageInputSchema>;

export const aiCrmActionSchema = z.object({
  tool: z.string(),
  summary: z.string(),
});
export type AiCrmAction = z.infer<typeof aiCrmActionSchema>;

export const aiCrmPendingSchema = z.object({
  tool: z.string(),
  summary: z.string(),
});
export type AiCrmPending = z.infer<typeof aiCrmPendingSchema>;

export const aiCrmMessageResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(aiCrmActionSchema),
  pending: aiCrmPendingSchema.nullable(),
  provider: z.string().nullable(),
});
export type AiCrmMessageResponse = z.infer<typeof aiCrmMessageResponseSchema>;

export const aiCrmRecentActionSchema = z.object({
  tool: z.string(),
  summary: z.string(),
  createdAt: z.string(),
});
export type AiCrmRecentAction = z.infer<typeof aiCrmRecentActionSchema>;

export const aiCrmIndexResponseSchema = z.object({
  recent: z.array(aiCrmRecentActionSchema),
  waCopilotEnabled: z.boolean(),
  canManageSettings: z.boolean(),
});
export type AiCrmIndexResponse = z.infer<typeof aiCrmIndexResponseSchema>;

export const aiCrmSettingsInputSchema = z.object({
  waCopilotEnabled: z.boolean(),
});
export type AiCrmSettingsInput = z.infer<typeof aiCrmSettingsInputSchema>;

export const aiCrmSettingsResponseSchema = z.object({
  waCopilotEnabled: z.boolean(),
});
export type AiCrmSettingsResponse = z.infer<typeof aiCrmSettingsResponseSchema>;

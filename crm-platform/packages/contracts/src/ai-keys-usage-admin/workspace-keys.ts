import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { AI_KEY_SOURCES, aiProviderSlugSchema } from './catalog';

/**
 * A workspace's own provider keys, "bring your own key" (WD-AIADM-011..015). The secret is write-only.
 * Whether a saved key is actually used is decided when a call resolves its key (the plan feature
 * allow_byok_ai_keys), so `byokAllowed` tells the screen what to expect.
 */

export const workspaceAiKeyItemSchema = z.object({
  id: uuidSchema,
  provider: aiProviderSlugSchema,
  isActive: z.boolean(),
  keyLast4: z.string().nullable(),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type WorkspaceAiKeyItem = z.infer<typeof workspaceAiKeyItemSchema>;

export const workspaceAiKeysResponseSchema = z.object({
  data: z.array(workspaceAiKeyItemSchema),
  /** Whether this workspace's plan (or ownership) lets its own keys take precedence. */
  byokAllowed: z.boolean(),
  /** For each provider the workspace could use: which key a call would take right now. */
  sources: z.array(z.object({ provider: aiProviderSlugSchema, source: z.enum(AI_KEY_SOURCES) })),
});
export type WorkspaceAiKeysResponse = z.infer<typeof workspaceAiKeysResponseSchema>;

export const saveWorkspaceAiKeySchema = z.object({
  apiKey: z.string().trim().min(8).max(1024),
});
export type SaveWorkspaceAiKeyInput = z.infer<typeof saveWorkspaceAiKeySchema>;

export const setWorkspaceAiKeyActiveSchema = z.object({ isActive: z.boolean() });
export type SetWorkspaceAiKeyActiveInput = z.infer<typeof setWorkspaceAiKeyActiveSchema>;

/** One option of a model picker (WD-AIADM-015). */
export const aiModelOptionSchema = z.object({
  value: z.string(),
  provider: aiProviderSlugSchema,
  providerName: z.string(),
  source: z.enum(['platform', 'workspace']),
});
export type AiModelOption = z.infer<typeof aiModelOptionSchema>;
export const aiModelsResponseSchema = z.object({ data: z.array(aiModelOptionSchema) });
export type AiModelsResponse = z.infer<typeof aiModelsResponseSchema>;

import { z } from 'zod';

/**
 * Who answers the workspace's WhatsApp (TW-AIAG responder mode): our AI, or Meta's own Business Agent, so a customer never
 * gets two replies. The two settings live on `workspace_settings`; the conversation runtime reads them.
 */
export const AIAG_RESPONDER_MODES = [
  'threadwise_only',
  'meta_agent_only',
  'meta_agent_then_handoff',
] as const;
export type AiagResponderMode = (typeof AIAG_RESPONDER_MODES)[number];

export const aiagResponderSchema = z.object({
  mode: z.enum(AIAG_RESPONDER_MODES),
  metaAgentEnabled: z.boolean(),
});
export type AiagResponder = z.infer<typeof aiagResponderSchema>;

export const saveAiagResponderSchema = z.strictObject({
  mode: z.enum(AIAG_RESPONDER_MODES),
  metaAgentEnabled: z.boolean().default(false),
});
export type SaveAiagResponderInput = z.input<typeof saveAiagResponderSchema>;

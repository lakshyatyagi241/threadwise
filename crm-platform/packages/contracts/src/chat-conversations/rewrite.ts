import { z } from 'zod';

/** What the composer's AI button ("Smart AI Assistant") can do to the text an agent is writing. */
export const INBOX_REWRITE_ACTIONS = ['condense', 'fix', 'positive', 'translate'] as const;
export const inboxRewriteActionSchema = z.enum(INBOX_REWRITE_ACTIONS);
export type InboxRewriteAction = z.infer<typeof inboxRewriteActionSchema>;

export const INBOX_REWRITE_TEXT_MAX = 4000;

/**
 * `POST /inbox/ai/rewrite`: the agent's draft in, a better version out. Nothing is stored and nothing is sent to the customer: the
 * composer shows the result in the box for the agent to read, edit and send. `translate` needs `language`, the English name of the
 * language to write it in (for example `Arabic`).
 */
export const inboxRewriteSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic', 'gemini', 'openrouter']),
    model: z.string().trim().min(1).max(120),
    action: inboxRewriteActionSchema,
    text: z.string().trim().min(1).max(INBOX_REWRITE_TEXT_MAX),
    language: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[\p{L}\p{M} ()'.-]+$/u, 'a language name')
      .optional(),
  })
  .refine((v) => v.action !== 'translate' || v.language !== undefined, {
    path: ['language'],
    message: 'Choose the language to translate to.',
  });
export type InboxRewriteInput = z.infer<typeof inboxRewriteSchema>;

export const inboxRewriteResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
});
export type InboxRewriteResponse = z.infer<typeof inboxRewriteResponseSchema>;

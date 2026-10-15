import { z } from 'zod';
import { HELP_AGENT_MAX_STEPS } from '@crm/contracts';

/**
 * Settings of the Help assistant (docs/specs/help-agent-assistant.md). No key lives here: the model vendor's key is the platform's (or
 * the workspace's own) in the AI keys tables, picked by `AiKeyResolver`. These choose WHICH vendor and model the assistant uses and
 * how much one person, one task and one workspace may spend. Read at call time, like the other domain files, so a test can change
 * them or point the vendor at a local stub.
 */
const helpAgentEnvSchema = z.object({
  /** The vendor the assistant calls. Must speak the OpenAI chat-completions dialect with tool calls. */
  HELP_AGENT_PROVIDER: z.enum(['openai', 'openrouter', 'mistral', 'deepseek', 'groq']).default('openai'),
  /** The model. Empty = the default model of the platform's key row for the vendor. */
  HELP_AGENT_MODEL: z.string().trim().max(120).default(''),
  /** Replaces the vendor's base URL (a gateway, or a stub in tests). */
  HELP_AGENT_BASE_URL: z.string().url().optional(),
  HELP_AGENT_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(120_000).default(45_000),
  /** Model calls one task may use. */
  HELP_AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(HELP_AGENT_MAX_STEPS),
  /** Minutes a task may stay open. */
  HELP_AGENT_TASK_MINUTES: z.coerce.number().int().min(1).max(120).default(25),
  /** Prompt plus completion tokens one task may use. */
  HELP_AGENT_TASK_TOKENS: z.coerce.number().int().min(1_000).max(5_000_000).default(400_000),
  /** Output tokens asked of the vendor for one step. */
  HELP_AGENT_STEP_MAX_TOKENS: z.coerce.number().int().min(100).max(8_000).default(3_000),
  /** Characters of messages one model call may carry (the page text is most of it). */
  HELP_AGENT_REQUEST_CHARS: z.coerce.number().int().min(5_000).max(1_000_000).default(120_000),
  HELP_AGENT_TASKS_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(3),
  HELP_AGENT_TASKS_PER_USER_DAY: z.coerce.number().int().min(1).max(1_000).default(40),
  HELP_AGENT_TASKS_PER_ORG_DAY: z.coerce.number().int().min(1).max(100_000).default(400),
});

export type HelpAgentEnv = z.infer<typeof helpAgentEnvSchema>;

/** Reads and validates the assistant settings; a bad value stops the boot with a readable message. */
export function readHelpAgentEnv(
  raw: Record<string, string | undefined> = process.env,
): HelpAgentEnv {
  const blank = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim();
  const keys = Object.keys(helpAgentEnvSchema.shape) as Array<keyof HelpAgentEnv>;
  const parsed = helpAgentEnvSchema.safeParse(
    Object.fromEntries(keys.map((k) => [k, blank(raw[k])])),
  );
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Help assistant configuration:\n${details}\n`);
  }
  return parsed.data;
}

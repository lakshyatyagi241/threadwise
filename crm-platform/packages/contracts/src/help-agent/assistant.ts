import { z } from 'zod';

/** Steps (model calls) one task may take. The server enforces it; the web reads the value the task start returns. */
export const HELP_AGENT_MAX_STEPS = 25;
/** The longest task sentence the panel accepts. */
export const HELP_AGENT_MAX_TASK_CHARS = 600;
/** The biggest model request the proxy reads: the page text is most of it (the API's body parser allows exactly this much). */
export const HELP_AGENT_MAX_BODY_BYTES = 512 * 1024;
/** Bump when the first-use notice text changes, so people are shown it again. */
export const HELP_AGENT_NOTICE_VERSION = 1;

export const HELP_AGENT_OUTCOMES = ['completed', 'failed', 'stopped', 'error'] as const;
export type HelpAgentOutcome = (typeof HELP_AGENT_OUTCOMES)[number];

/** Why the assistant is not available to this person, when it is not (the launcher uses it only to stay hidden). */
export const helpAgentStatusSchema = z.object({
  /** All three switches are on for this person: the plan, the workspace setting and the permission. */
  available: z.boolean(),
  /** The workspace setting. Read by the settings screen. */
  enabled: z.boolean(),
  /** The caller may change the workspace setting (`help.agent.manage`). */
  canManage: z.boolean(),
  limits: z.object({
    maxSteps: z.number().int(),
    tasksLeftToday: z.number().int(),
  }),
});
export type HelpAgentStatus = z.infer<typeof helpAgentStatusSchema>;

export const helpAgentSettingsSchema = z.object({ enabled: z.boolean() });
export type HelpAgentSettings = z.infer<typeof helpAgentSettingsSchema>;

export const saveHelpAgentSettingsSchema = z.object({ enabled: z.boolean() });
export type SaveHelpAgentSettingsInput = z.infer<typeof saveHelpAgentSettingsSchema>;

export const startHelpAgentTaskSchema = z.object({
  /** The person's interface language (a message locale). */
  locale: z.string().trim().min(2).max(12),
  /** Only the LENGTH of the task sentence is sent: the sentence itself is never stored. */
  taskLength: z.number().int().min(1).max(HELP_AGENT_MAX_TASK_CHARS),
  /** The page path the task starts on (no query, no hash). */
  route: z.string().trim().min(1).max(300),
});
export type StartHelpAgentTaskInput = z.infer<typeof startHelpAgentTaskSchema>;

export const helpAgentTaskStartedSchema = z.object({
  taskId: z.string().uuid(),
  maxSteps: z.number().int(),
  expiresAt: z.string(),
});
export type HelpAgentTaskStarted = z.infer<typeof helpAgentTaskStartedSchema>;

export const finishHelpAgentTaskSchema = z.object({
  outcome: z.enum(HELP_AGENT_OUTCOMES),
  steps: z.number().int().min(0).max(1000),
  confirmedActions: z.number().int().min(0).max(1000),
  deniedActions: z.number().int().min(0).max(1000),
});
export type FinishHelpAgentTaskInput = z.infer<typeof finishHelpAgentTaskSchema>;

/** Header carrying the task id on every model call. */
export const HELP_AGENT_TASK_HEADER = 'x-help-agent-task';

export const helpAgentTaskFinishedSchema = z.object({ status: z.string() });

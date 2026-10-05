import { z } from 'zod';

/**
 * Geta console publishing (an addition beyond Reference: docs/api/flow-builder-editor.md, "Geta publishing").
 *
 * When a flow is published here, the workspace's bot is also pushed live on the Geta console in two calls, in this order:
 * 1. `configuration_update`: `PUT {baseUrl}/api/v1/chatbot/{chatbotId}/configuration/update/` with `{ chatbot: <the record> }`
 * 2. `publish_bot`: `POST {baseUrl}/api/v1/console/publish-bot` (the `appid` header names the bot, the body is `{}`)
 * The flow counts as `live` there only when both answered 2xx. Nothing in these shapes carries a secret back to the browser:
 * the tokens are write-only, the chatbot record is shown as a summary.
 */

export const GETA_PUBLISH_STEPS = ['configuration_update', 'publish_bot'] as const;
export const getaPublishStepSchema = z.enum(GETA_PUBLISH_STEPS);
export type GetaPublishStep = z.infer<typeof getaPublishStepSchema>;

/**
 * What the editor shows next to the Published badge.
 * `none`: published here, nothing pushed yet (or the flow is a draft). `not_configured`: the workspace has no Geta credentials.
 * `pending`: queued or being pushed ("Going live..."). `live`: both calls answered 2xx. `failed`: a call failed, `failedStep` names it.
 * The database stores only `pending | live | failed` (plus an internal `idle` for a row that only holds a per-flow record).
 */
export const GETA_SYNC_STATES = ['none', 'not_configured', 'pending', 'live', 'failed'] as const;
export const getaSyncStateSchema = z.enum(GETA_SYNC_STATES);
export type GetaSyncState = z.infer<typeof getaSyncStateSchema>;

export const GETA_MODES = ['fixture', 'live'] as const;
export const getaModeSchema = z.enum(GETA_MODES);
export type GetaMode = z.infer<typeof getaModeSchema>;

/** What an error message keeps of a Geta response body. */
export const GETA_ERROR_MAX_CHARS = 300;
export const GETA_CHATBOT_RECORD_MAX_CHARS = 262_144;
const TOKEN_MAX = 4096;
const URL_MAX = 300;

/** The few fields of the Geta chatbot record we show back (never the record itself: it carries business and workspace ids). */
export const getaChatbotSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  botId: z.string(),
});
export type GetaChatbotSummary = z.infer<typeof getaChatbotSummarySchema>;

/**
 * The Geta chatbot record is owned by Geta: we keep what the user pasted and send it as it is. Only `id` (the path segment of call 1)
 * and `bot_id` (the `appid` header of call 2) are required; every other field passes through untouched.
 */
export const getaChatbotRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    bot_id: z.string().trim().min(1).max(128),
    name: z.unknown().optional(),
  })
  .passthrough();
export type GetaChatbotRecord = z.infer<typeof getaChatbotRecordSchema>;

export type GetaChatbotParse =
  { ok: true; record: GetaChatbotRecord } | { ok: false; message: string };

/**
 * Reads the pasted JSON text. Accepts the bare record or the whole request body `{ "chatbot": { ... } }`. The messages never echo the
 * input (it may hold ids), only what is wrong with its shape.
 */
export function parseGetaChatbotRecord(text: string): GetaChatbotParse {
  if (text.length > GETA_CHATBOT_RECORD_MAX_CHARS)
    return { ok: false, message: 'The chatbot record is too large.' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'The chatbot record is not valid JSON.' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const inner = (value as Record<string, unknown>).chatbot;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) value = inner;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, message: 'The chatbot record must be a JSON object.' };
  const parsed = getaChatbotRecordSchema.safeParse(value);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean);
    return {
      ok: false,
      message: `The chatbot record needs a non-empty ${[...new Set(missing)].join(' and ') || 'id and bot_id'}.`,
    };
  }
  return { ok: true, record: parsed.data };
}

/** `Authorization` / `geta-host` values are sent as they are: one line of printable text, so a pasted newline cannot add a header. */
const headerValue = z
  .string()
  .trim()
  .min(1, 'Required.')
  .max(TOKEN_MAX)
  .regex(/^[\x20-\x7E]+$/, 'Use printable characters on a single line.');

/** `null` clears the value, a missing key leaves it as it is. */
export const updateGetaPublishSettingsRequestSchema = z.object({
  baseUrl: z.string().trim().url().max(URL_MAX).nullable().optional(),
  origin: z.string().trim().url().max(URL_MAX).nullable().optional(),
  authorization: headerValue.nullable().optional(),
  getaHost: headerValue.nullable().optional(),
  chatbotRecord: z.string().max(GETA_CHATBOT_RECORD_MAX_CHARS).nullable().optional(),
});
export type UpdateGetaPublishSettingsRequest = z.infer<
  typeof updateGetaPublishSettingsRequestSchema
>;

/** Secrets as flags only; the chatbot record as a summary. */
export const getaPublishSettingsSchema = z.object({
  mode: getaModeSchema,
  baseUrl: z.string().nullable(),
  origin: z.string().nullable(),
  authorizationSet: z.boolean(),
  getaHostSet: z.boolean(),
  chatbot: getaChatbotSummarySchema.nullable(),
  /** All four required values are present. */
  configured: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type GetaPublishSettings = z.infer<typeof getaPublishSettingsSchema>;

/** The per-flow record that replaces the workspace one for this flow (`null` removes the override). */
export const setFlowGetaChatbotRequestSchema = z.object({
  chatbotRecord: z.string().max(GETA_CHATBOT_RECORD_MAX_CHARS).nullable(),
});
export type SetFlowGetaChatbotRequest = z.infer<typeof setFlowGetaChatbotRequestSchema>;

/** The remote state of one flow. */
export const flowGetaSyncSchema = z.object({
  state: getaSyncStateSchema,
  /** The step in progress while `pending`, else the last step reached (`null` for none). */
  step: getaPublishStepSchema.nullable(),
  /** Set while `failed`: where Retry resumes. */
  failedStep: getaPublishStepSchema.nullable(),
  /** Sanitised: no token, no header, a cut response body. */
  lastError: z.string().nullable(),
  attemptedAt: z.string().datetime().nullable(),
  /** The bot id the push used (or will use). */
  botId: z.string().nullable(),
  publishVersion: z.number().int().nullable(),
  /** The workspace has Geta credentials. */
  configured: z.boolean(),
  /** Summary of this flow's own record, when it has one. */
  chatbotOverride: getaChatbotSummarySchema.nullable(),
});
export type FlowGetaSync = z.infer<typeof flowGetaSyncSchema>;

/** The empty answer for a flow that was never pushed. */
export const NO_GETA_SYNC: FlowGetaSync = {
  state: 'none',
  step: null,
  failedStep: null,
  lastError: null,
  attemptedAt: null,
  botId: null,
  publishVersion: null,
  configured: false,
  chatbotOverride: null,
};

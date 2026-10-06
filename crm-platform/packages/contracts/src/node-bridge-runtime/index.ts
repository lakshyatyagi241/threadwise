/**
 * node-bridge-runtime (NODE): the settings an operator edits for the WhatsApp Node bridge, and the one machine-to-machine
 * shape the bridge pulls. Everything here crosses the network boundary.
 */
import { z } from 'zod';

/** WaDesk defaults (WD-NODE-029): 3 s between sends, batches of 50, 5 minutes between batches, batching off. */
export const NODE_PACING_DEFAULTS = {
  msgGap: 3,
  batchesGap: 50,
  bwMsgGap: 5,
  enableBatches: false,
} as const;

const httpUrl = (v: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v);

/** Blank clears the saved address; anything else must be an http(s) URL of at most 191 characters (WD-NODE-052). */
const serverUrlSchema = z
  .string()
  .trim()
  .max(191)
  .refine((v) => v === '' || httpUrl(v), 'Enter a valid Server URL (http:// or https://).');

export const nodePacingSchema = z.object({
  /** Seconds between consecutive sends. */
  msgGap: z.number().int().min(1).max(600),
  /** Recipients per batch. */
  batchesGap: z.number().int().min(1).max(10000),
  /** Minutes between batches. */
  bwMsgGap: z.number().int().min(1).max(1440),
  enableBatches: z.boolean(),
});
export type NodePacing = z.infer<typeof nodePacingSchema>;

export const nodeBridgeResponseSchema = z.object({
  serverUrl: z.string(),
  /** The shared secret is write-only: only whether one is saved is ever returned. */
  tokenSet: z.boolean(),
  /** Version of the address + token document, sent back on save. */
  rowVersion: z.number().int(),
  pacing: nodePacingSchema,
  pacingRowVersion: z.number().int(),
  /**
   * Whether the unofficial WhatsApp engine (personal numbers over Baileys, channel `whatsapp_qr`) is on for the whole
   * platform. Off unless a super admin turns it on (owner decision 2026-10-05).
   */
  unofficialEnabled: z.boolean(),
});
export type NodeBridgeResponse = z.infer<typeof nodeBridgeResponseSchema>;

export const updateNodeBridgeSchema = z.object({
  serverUrl: serverUrlSchema,
  /** Blank keeps the stored token; a value replaces it (WD-NODE-052). */
  token: z.string().trim().max(191).optional(),
  rowVersion: z.number().int().min(0),
});
export type UpdateNodeBridgeInput = z.infer<typeof updateNodeBridgeSchema>;

export const updateNodePacingSchema = nodePacingSchema.extend({
  rowVersion: z.number().int().min(0),
});
export type UpdateNodePacingInput = z.infer<typeof updateNodePacingSchema>;

export const updateUnofficialWhatsappSchema = z.object({ enabled: z.boolean() });
export type UpdateUnofficialWhatsappInput = z.infer<typeof updateUnofficialWhatsappSchema>;

export const unofficialWhatsappStateSchema = z.object({ unofficialEnabled: z.boolean() });
export type UnofficialWhatsappState = z.infer<typeof unofficialWhatsappStateSchema>;

/** The synthetic entitlement key `GET /v2/billing/entitlements` carries only while the unofficial engine is on. Not a plan feature. */
export const UNOFFICIAL_WHATSAPP_FEATURE_KEY = 'unofficial_whatsapp';

export const nodeBridgeTestRequestSchema = z.object({
  serverUrl: z.string().trim().max(191),
  /** Blank tests with the stored token. */
  token: z.string().trim().max(191).optional(),
});
export type NodeBridgeTestRequest = z.infer<typeof nodeBridgeTestRequestSchema>;

export const nodeBridgeTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type NodeBridgeTestResult = z.infer<typeof nodeBridgeTestResultSchema>;

/**
 * What the bridge pulls on a timer (WaDesk `GET api/whatsapp-message-settings`). Snake case and 0/1 are the bridge's
 * wire format, not ours: the existing bridge reads exactly these names.
 */
export const nodeMessageSettingsSchema = z.object({
  success: z.literal(true),
  msg_gap: z.number().int(),
  batches_gap: z.number().int(),
  bw_msg_gap: z.number().int(),
  enable_batches: z.union([z.literal(0), z.literal(1)]),
});
export type NodeMessageSettings = z.infer<typeof nodeMessageSettingsSchema>;

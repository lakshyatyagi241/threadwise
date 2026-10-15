/**
 * node-bridge-runtime (NODE): the settings an operator edits for the WhatsApp Node bridge, and the one machine-to-machine
 * shape the bridge pulls. Everything here crosses the network boundary.
 */
import { z } from 'zod';
import { cursorSchema, pageResponseSchema } from '../common/pagination';

/** Reference defaults (TW-NODE-029): 3 s between sends, batches of 50, 5 minutes between batches, batching off. */
export const NODE_PACING_DEFAULTS = {
  msgGap: 3,
  batchesGap: 50,
  bwMsgGap: 5,
  enableBatches: false,
} as const;

const httpUrl = (v: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v);

/**
 * The bridge may live on the same machine or network (that is the usual set-up), so private ranges stay allowed; the link-local
 * range and the cloud metadata names are never a bridge, and are what a redirect or a typo would otherwise reach.
 */
export const bridgeHostAllowed = (v: string): boolean => {
  const m = /^https?:\/\/(?:[^@\/?#]*@)?(\[[^\]]+\]|[^:\/?#]+)/i.exec(v.trim());
  if (!m) return false;
  const h = m[1]!.toLowerCase().replace(/^\[|\]$/g, '');
  return !(
    /^169\.254\./.test(h) ||
    /^fe[89ab][0-9a-f]:/.test(h) ||
    h.startsWith('fd00:ec2:') ||
    h.startsWith('::ffff:a9fe:') ||
    h.startsWith('::ffff:169.254.') ||
    h === 'metadata' ||
    h.startsWith('metadata.') ||
    h.endsWith('.internal')
  );
};

/** Blank clears the saved address; anything else must be an http(s) URL of at most 191 characters (TW-NODE-052). */
const serverUrlSchema = z
  .string()
  .trim()
  .max(191)
  .refine((v) => v === '' || httpUrl(v), 'Enter a valid Server URL (http:// or https://).')
  .refine((v) => v === '' || !httpUrl(v) || bridgeHostAllowed(v), 'That address cannot be a bridge.');

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
  /** How many workspaces are on the unofficial engine's allow-list (owner decision 2026-10-06). Counted whether or not the platform switch is on. */
  unofficialWorkspaceCount: z.number().int().min(0),
});
export type NodeBridgeResponse = z.infer<typeof nodeBridgeResponseSchema>;

export const updateNodeBridgeSchema = z.object({
  serverUrl: serverUrlSchema,
  /** Blank keeps the stored token; a value replaces it (TW-NODE-052). */
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

/**
 * The synthetic entitlement key `GET /v2/billing/entitlements` carries only while the platform switch is on AND the asking workspace
 * is on the allow-list (owner decision 2026-10-06). Not a plan feature.
 */
export const UNOFFICIAL_WHATSAPP_FEATURE_KEY = 'unofficial_whatsapp';

export const nodeBridgeTestRequestSchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .max(191)
    .refine((v) => v === '' || (httpUrl(v) && bridgeHostAllowed(v)), 'Enter a valid Server URL (http:// or https://).'),
  /** Blank tests with the stored token. */
  token: z.string().trim().max(191).optional(),
});
export type NodeBridgeTestRequest = z.infer<typeof nodeBridgeTestRequestSchema>;

export const nodeBridgeTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type NodeBridgeTestResult = z.infer<typeof nodeBridgeTestResultSchema>;

/**
 * What the bridge pulls on a timer (Reference `GET api/whatsapp-message-settings`). Snake case and 0/1 are the bridge's
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

// --- the per-workspace allow-list (owner decision 2026-10-06) ------------------------------------------------------------------
// The platform switch above is the global kill-switch. A workspace may use the unofficial engine only when the switch is on AND
// a platform super admin put the workspace on this list.

export const unofficialWorkspaceSchema = z.object({
  orgUuid: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  planSlug: z.string().nullable(),
  enabledAt: z.string().datetime({ offset: true }),
  /** The operator who allowed the workspace; null when that operator no longer exists. */
  enabledBy: z
    .object({ operatorUuid: z.string().uuid().optional(), name: z.string().optional() })
    .nullable(),
  note: z.string(),
  /** Devices rows of the workspace. */
  deviceCount: z.number().int().min(0),
  /** Devices whose status is `connected`. */
  activeDeviceCount: z.number().int().min(0),
});
export type UnofficialWorkspace = z.infer<typeof unofficialWorkspaceSchema>;

export const unofficialWorkspaceListQuerySchema = z.object({
  /** Substring of the workspace name or slug. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type UnofficialWorkspaceListQuery = z.infer<typeof unofficialWorkspaceListQuerySchema>;

export const unofficialWorkspaceListResponseSchema = pageResponseSchema(unofficialWorkspaceSchema);
export type UnofficialWorkspaceListResponse = z.infer<typeof unofficialWorkspaceListResponseSchema>;

/** One hit of the "add workspace" picker. */
export const unofficialWorkspaceOptionSchema = z.object({
  orgUuid: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  planSlug: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  alreadyEnabled: z.boolean(),
});
export type UnofficialWorkspaceOption = z.infer<typeof unofficialWorkspaceOptionSchema>;

export const unofficialWorkspaceOptionsQuerySchema = z.object({
  /** Substring of the workspace name, slug or the owner's email. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export type UnofficialWorkspaceOptionsQuery = z.infer<typeof unofficialWorkspaceOptionsQuerySchema>;

export const unofficialWorkspaceOptionListResponseSchema = z.object({
  data: z.array(unofficialWorkspaceOptionSchema),
});
export type UnofficialWorkspaceOptionListResponse = z.infer<
  typeof unofficialWorkspaceOptionListResponseSchema
>;

export const setUnofficialWorkspaceInputSchema = z.object({
  /** true allows the workspace (upsert, a re-send updates the note); false removes it from the list. */
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type SetUnofficialWorkspaceInput = z.infer<typeof setUnofficialWorkspaceInputSchema>;

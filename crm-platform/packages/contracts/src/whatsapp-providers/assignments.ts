import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import {
  whatsappCredentialModeSchema,
  whatsappOnboardingMethodSchema,
  whatsappProviderCapabilitiesSchema,
} from './enums';
import { providerSummarySchema, providerTestResultSchema } from './providers';

/**
 * Who sends through which provider: the platform default (set on the provider), a workspace override, and the switch of a workspace's
 * connected numbers from one provider to another.
 *
 * The provider a NEW number connects through = the workspace's override, else the registry default, else the platform's own setting
 * (the console WhatsApp page / `WABA_DEFAULT_PROVIDER`). A number keeps the provider it was connected under (`provider_key` on the
 * connection) until an operator switches it: changing a default or an override never re-routes live traffic by itself.
 */

// --- assignments ----------------------------------------------------------------------------------------------------------------

export const assignmentSourceSchema = z.enum(['override', 'default', 'platform_setting']);
export type AssignmentSource = z.infer<typeof assignmentSourceSchema>;

export const listAssignmentsQuerySchema = z.object({
  /** Matches the workspace name or slug. */
  search: z.string().trim().min(1).max(100).optional(),
  /** Only workspaces that have an override. */
  overrideOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

export const workspaceAssignmentSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  /** The workspace's own override; null when it follows the default. */
  override: providerSummarySchema.nullable(),
  /** Where a number connected NOW would be routed. `platform_setting`: no override and no registry default, the env/console setting decides. */
  effective: z.object({
    source: assignmentSourceSchema,
    providerKey: z.string(),
    provider: providerSummarySchema.nullable(),
  }),
  /** Connected WABA numbers the workspace has, and how many of them are on a provider other than the effective one. */
  numberCount: z.number().int().nonnegative(),
  numbersOnOtherProvider: z.number().int().nonnegative(),
  assignedAt: z.string().datetime().nullable(),
});
export type WorkspaceAssignment = z.infer<typeof workspaceAssignmentSchema>;

export const listAssignmentsResponseSchema = z.object({
  data: z.array(workspaceAssignmentSchema),
  page: pageInfoSchema,
  /** The registry default (null: none set; the platform setting decides). */
  registryDefault: providerSummarySchema.nullable(),
});
export type ListAssignmentsResponse = z.infer<typeof listAssignmentsResponseSchema>;

/** Set the override of one workspace. Clearing is `DELETE`. Only an active provider can be assigned. */
export const setAssignmentSchema = z
  .object({
    providerId: uuidSchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type SetAssignmentInput = z.infer<typeof setAssignmentSchema>;

// --- the switch -----------------------------------------------------------------------------------------------------------------

/**
 * Move a workspace's connected WhatsApp numbers to another provider, optionally also making that provider the workspace's override so
 * numbers connected later follow. `dryRun` changes nothing and lists, per number, what would happen and what still needs a person.
 * Without `dryRun` each number is moved on its own: the webhook is re-subscribed through the new route first and the number is only
 * re-pointed when that worked, so a number is never left half moved. To roll back, switch back to the previous provider (the answer
 * names it per number).
 */
export const switchWorkspaceProviderSchema = z
  .object({
    targetProviderId: uuidSchema,
    /** Only numbers currently on this provider (default: every number not already on the target). */
    fromProviderId: uuidSchema.optional(),
    /** Only these numbers (connection ids). */
    numberIds: z.array(uuidSchema).min(1).max(50).optional(),
    dryRun: z.boolean().default(false),
    /** Also set the workspace's override to the target (applied only when not a dry run). */
    setOverride: z.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type SwitchWorkspaceProviderInput = z.infer<typeof switchWorkspaceProviderSchema>;

/** What a number needs before or after the move. */
export const SWITCH_REQUIREMENTS = [
  /** The target is `channel_token` and the number holds no access token: paste one or reconnect. */
  'number_token_needed',
  /** The target is `platform_token` and the provider has no token stored yet. */
  'provider_token_needed',
  /** The number has no WABA id / phone number id on record. */
  'ids_missing',
  /** The number is disconnected: it is re-pointed only, and needs a reconnect before it can send. */
  'reconnect_needed',
] as const;
export const switchRequirementSchema = z.enum(SWITCH_REQUIREMENTS);
export type SwitchRequirement = z.infer<typeof switchRequirementSchema>;

export const SWITCH_NUMBER_STATES = [
  'ready',
  'blocked',
  'switched',
  'repointed',
  'failed',
] as const;
export const switchNumberStateSchema = z.enum(SWITCH_NUMBER_STATES);

export const switchNumberOutcomeSchema = z.object({
  numberId: uuidSchema,
  label: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  from: providerSummarySchema.nullable(),
  /**
   * Dry run: `ready` (would move) or `blocked` (see `requirements`). Applied: `switched` (re-subscribed and moved), `repointed` (a
   * disconnected number, only re-pointed) or `failed` (nothing changed; `message` says why).
   */
  state: switchNumberStateSchema,
  requirements: z.array(switchRequirementSchema),
  /** The webhook was re-subscribed through the new route (applied) or would be (dry run). */
  resubscribe: z.boolean(),
  /** The provider answered the callback override; false with `state: switched` means the app-level callback still applies. */
  inboundWired: z.boolean().nullable(),
  message: z.string().nullable(),
});
export type SwitchNumberOutcome = z.infer<typeof switchNumberOutcomeSchema>;

export const switchWorkspaceProviderResponseSchema = z.object({
  dryRun: z.boolean(),
  workspaceId: uuidSchema,
  to: providerSummarySchema,
  /** The override was set to the target by this call. */
  overrideSet: z.boolean(),
  numbers: z.array(switchNumberOutcomeSchema),
});
export type SwitchWorkspaceProviderResponse = z.infer<typeof switchWorkspaceProviderResponseSchema>;

// --- live test ------------------------------------------------------------------------------------------------------------------

const graphIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, 'Letters, digits and . _ : - only');

/**
 * A live test of one provider: one authenticated GET to its base URL. The optional ids and test token only fill header placeholders of
 * the call; they are used for it and forgotten (not stored, not logged, not echoed).
 */
export const testWhatsappProviderSchema = z
  .object({
    /** Path under `<baseUrl>/<apiVersion>`; a read the provider answers for an authenticated caller. */
    path: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9_./-]{0,120}$/, 'Starts with / and holds letters, digits and . _ / -')
      .default('/me'),
    wabaId: graphIdSchema.optional(),
    phoneNumberId: graphIdSchema.optional(),
    /** For a `channel_token` provider: the token of a test number. */
    channelToken: z
      .string()
      .trim()
      .min(8)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
  })
  .strict();
export type TestWhatsappProviderInput = z.infer<typeof testWhatsappProviderSchema>;

export const testWhatsappProviderResponseSchema = z.object({
  provider: providerSummarySchema,
  result: providerTestResultSchema,
});
export type TestWhatsappProviderResponse = z.infer<typeof testWhatsappProviderResponseSchema>;

// --- tenant-safe read -----------------------------------------------------------------------------------------------------------

/**
 * `GET /v2/waba/provider-info`: what the CALLER'S workspace may know about how WhatsApp is carried, so its screens can ask for the right
 * things. Names the provider (key and label) but never an address, header, secret or id of the provider.
 */
export const channelProviderNumberSchema = z.object({
  id: uuidSchema,
  label: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  providerKey: z.string(),
  providerLabel: z.string(),
  credentialMode: whatsappCredentialModeSchema,
  capabilities: whatsappProviderCapabilitiesSchema,
});

export const channelProviderInfoSchema = z.object({
  /** The provider a number connected now goes through; null when none can take one (the assigned provider is not active). */
  newNumbers: z
    .object({
      providerKey: z.string(),
      providerLabel: z.string(),
      /** `channel_token`: the workspace connects with its own access token. `platform_token`: it connects with ids only. */
      credentialMode: whatsappCredentialModeSchema,
      capabilities: whatsappProviderCapabilitiesSchema,
      onboardingMethods: z.array(whatsappOnboardingMethodSchema),
    })
    .nullable(),
  numbers: z.array(channelProviderNumberSchema),
});
export type ChannelProviderInfo = z.infer<typeof channelProviderInfoSchema>;

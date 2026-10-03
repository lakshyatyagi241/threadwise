import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import {
  whatsappCredentialModeSchema,
  whatsappOnboardingMethodSchema,
  whatsappProviderStatusSchema,
} from './enums';
import { providerHealthCheckSchema, providerSummarySchema } from './providers';

/**
 * Operator API shapes for who sends through which provider: the platform default, a workspace override, a channel's snapshot, and
 * the switch operation.
 *
 * Effective provider of a workspace = its override if it has one, else the platform default. A WhatsApp channel takes a SNAPSHOT of
 * the effective provider when it is created (`channels.provider_id`) and keeps it until an operator switches it: changing the
 * default or an override never re-routes live traffic by itself.
 */

// --- assignments ----------------------------------------------------------------------------------------------------------------

export const assignmentSourceSchema = z.enum(['override', 'default', 'none']);
export type AssignmentSource = z.infer<typeof assignmentSourceSchema>;

export const listAssignmentsQuerySchema = z.object({
  /** Matches the workspace name or slug. */
  search: z.string().trim().min(1).max(100).optional(),
  /** Only workspaces whose effective provider is this one. */
  providerId: uuidSchema.optional(),
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
  effective: z.object({ source: assignmentSourceSchema, provider: providerSummarySchema.nullable() }),
  /** WhatsApp channels the workspace has, and how many of them sit on a provider other than the effective one. */
  whatsappChannelCount: z.number().int().nonnegative(),
  channelsOnOtherProvider: z.number().int().nonnegative(),
  assignedAt: z.string().datetime().nullable(),
});
export type WorkspaceAssignment = z.infer<typeof workspaceAssignmentSchema>;

export const listAssignmentsResponseSchema = z.object({
  data: z.array(workspaceAssignmentSchema),
  page: pageInfoSchema,
  /** The platform default (null: none set; channels created now would have no provider). */
  platformDefault: providerSummarySchema.nullable(),
});
export type ListAssignmentsResponse = z.infer<typeof listAssignmentsResponseSchema>;

/**
 * Set (`providerId`) or clear (`null`) the override of one or many workspaces. `dryRun` changes nothing and lists the channels that
 * would be affected. `switchExistingChannels` also switches each WhatsApp channel of those workspaces to the effective provider with
 * the same rules as a single switch (reachability test, queue check); without it only channels created later follow the change.
 */
export const setAssignmentsSchema = z
  .object({
    workspaceIds: z.array(uuidSchema).min(1).max(200),
    providerId: uuidSchema.nullable(),
    dryRun: z.boolean().default(false),
    switchExistingChannels: z.boolean().default(false),
    /** For the channel switches: go ahead although messages are queued. */
    force: z.boolean().default(false),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.switchExistingChannels && v.workspaceIds.length > 25) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workspaceIds'],
        message: 'Switching channels is limited to 25 workspaces per request',
      });
    }
  });
export type SetAssignmentsInput = z.infer<typeof setAssignmentsSchema>;

/**
 * What carries a WhatsApp number: an inbox `channel` (kind `whatsapp_cloud`) or a WABA connection of the WhatsApp number domain
 * (`waba_number`, a `wa_provider_configs` row). Both hold a snapshot of the provider they were created under, and both can be switched.
 */
export const whatsappNumberKindSchema = z.enum(['channel', 'waba_number']);
export type WhatsappNumberKind = z.infer<typeof whatsappNumberKindSchema>;

export const affectedChannelSchema = z.object({
  kind: whatsappNumberKindSchema,
  channelId: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  name: z.string(),
  currentProvider: providerSummarySchema.nullable(),
});
export type AffectedChannel = z.infer<typeof affectedChannelSchema>;

export const switchOutcomeSchema = z.object({
  kind: whatsappNumberKindSchema,
  channelId: uuidSchema,
  switched: z.boolean(),
  /** Why it was not switched (a problem code), when it was not. */
  refusedCode: z.string().nullable(),
  refusedMessage: z.string().nullable(),
});
export type SwitchOutcome = z.infer<typeof switchOutcomeSchema>;

export const setAssignmentsResponseSchema = z.object({
  dryRun: z.boolean(),
  provider: providerSummarySchema.nullable(),
  /** Workspaces whose override changed (or would), and those already as asked. */
  changed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  /** WhatsApp channels of these workspaces that sit on a provider other than the new effective one (first 200). */
  affectedChannels: z.array(affectedChannelSchema),
  affectedChannelTotal: z.number().int().nonnegative(),
  /** Present when `switchExistingChannels` ran: one outcome per channel. */
  switches: z.array(switchOutcomeSchema),
});
export type SetAssignmentsResponse = z.infer<typeof setAssignmentsResponseSchema>;

// --- the switch -----------------------------------------------------------------------------------------------------------------

/**
 * Switch one channel to another provider. Refused when the target is not active, when the channel lacks what the target needs, when
 * the target cannot reach the channel's WABA (a live test call is made first), and while messages are `queued` on the channel
 * (unless `force`: the queued messages are then sent through the new provider). Message history, wamids and receipts are provider
 * independent, so nothing about past messages changes. To roll back, switch to the previous provider (the answer names it).
 */
export const switchProviderSchema = z
  .object({
    targetProviderId: uuidSchema,
    force: z.boolean().default(false),
    /** Run every check and report, change nothing. */
    dryRun: z.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type SwitchProviderInput = z.infer<typeof switchProviderSchema>;

export const switchProviderResponseSchema = z.object({
  dryRun: z.boolean(),
  kind: whatsappNumberKindSchema,
  channelId: uuidSchema,
  workspaceId: uuidSchema,
  from: providerSummarySchema.nullable(),
  to: providerSummarySchema,
  switched: z.boolean(),
  forced: z.boolean(),
  /** Messages `queued` on the channel when the switch ran. */
  queuedMessages: z.number().int().nonnegative(),
  checks: z.array(providerHealthCheckSchema),
  /** The provider to switch back to to undo this (the previous one); null when the channel had none. */
  rollbackProviderId: uuidSchema.nullable(),
});
export type SwitchProviderResponse = z.infer<typeof switchProviderResponseSchema>;

/** The workspace-level switch: sets the override and switches every WhatsApp channel of the workspace (same rules per channel). */
export const switchWorkspaceProviderSchema = z
  .object({
    targetProviderId: uuidSchema,
    force: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type SwitchWorkspaceProviderInput = z.infer<typeof switchWorkspaceProviderSchema>;

export const switchWorkspaceProviderResponseSchema = z.object({
  dryRun: z.boolean(),
  workspaceId: uuidSchema,
  to: providerSummarySchema,
  overrideSet: z.boolean(),
  channels: z.array(switchOutcomeSchema),
});
export type SwitchWorkspaceProviderResponse = z.infer<typeof switchWorkspaceProviderResponseSchema>;

// --- channels on a provider, history ---------------------------------------------------------------------------------------------

export const listProviderChannelsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type ListProviderChannelsQuery = z.infer<typeof listProviderChannelsQuerySchema>;

export const providerChannelSchema = z.object({
  kind: whatsappNumberKindSchema,
  channelId: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  name: z.string(),
  displayAddress: z.string().nullable(),
  status: z.string(),
  /** Overall result of the channel's last health check (`healthy`, `attention`, `blocked`); null when never checked. */
  health: z.string().nullable(),
  healthCheckedAt: z.string().datetime().nullable(),
  lastEventAt: z.string().datetime().nullable(),
});
export type ProviderChannel = z.infer<typeof providerChannelSchema>;

export const listProviderChannelsResponseSchema = z.object({
  data: z.array(providerChannelSchema),
  page: pageInfoSchema,
});
export type ListProviderChannelsResponse = z.infer<typeof listProviderChannelsResponseSchema>;

export const providerEventKindSchema = z.enum([
  'provider_created',
  'provider_updated',
  'provider_deleted',
  'provider_enabled',
  'provider_disabled',
  'default_changed',
  'assignment_set',
  'assignment_cleared',
  'channel_switched',
  'health_degraded',
  'health_recovered',
]);
export type ProviderEventKind = z.infer<typeof providerEventKindSchema>;

export const listProviderEventsQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  channelId: uuidSchema.optional(),
  providerId: uuidSchema.optional(),
  kind: providerEventKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type ListProviderEventsQuery = z.infer<typeof listProviderEventsQuerySchema>;

export const providerEventSchema = z.object({
  id: uuidSchema,
  kind: providerEventKindSchema,
  workspaceId: uuidSchema.nullable(),
  channelId: uuidSchema.nullable(),
  from: providerSummarySchema.nullable(),
  to: providerSummarySchema.nullable(),
  operatorId: z.number().int().nullable(),
  detail: z.record(z.unknown()),
  at: z.string().datetime(),
});
export type ProviderEvent = z.infer<typeof providerEventSchema>;

export const listProviderEventsResponseSchema = z.object({
  data: z.array(providerEventSchema),
  page: pageInfoSchema,
});
export type ListProviderEventsResponse = z.infer<typeof listProviderEventsResponseSchema>;

// --- tenant-safe read -----------------------------------------------------------------------------------------------------------

/**
 * `GET /v2/channels/provider-info`: what the CALLER'S workspace may know about how WhatsApp is carried, so its connection screen can
 * ask for the right things. Never the provider's name, address or any secret. `embeddedSignup` carries the platform Meta app's public
 * ids that the signup widget needs; nothing else about the provider.
 */
export const channelProviderInfoSchema = z.object({
  /** `channel_token`: the workspace connects with its own access token. `platform_token`: it connects with ids only. */
  credentialMode: whatsappCredentialModeSchema,
  capabilities: z.object({
    templates: z.boolean(),
    mediaUpload: z.boolean(),
    businessProfile: z.boolean(),
    healthStatus: z.boolean(),
    analytics: z.boolean(),
    embeddedSignup: z.boolean(),
  }),
  onboardingMethods: z.array(whatsappOnboardingMethodSchema),
  embeddedSignup: z.object({ appId: z.string(), configId: z.string() }).nullable(),
});
export type ChannelProviderInfo = z.infer<typeof channelProviderInfoSchema>;

/** Used by tests and the web to type a provider's status. */
export const providerStatusFilterSchema = whatsappProviderStatusSchema;

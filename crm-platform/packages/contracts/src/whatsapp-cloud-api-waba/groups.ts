/**
 * WhatsApp Cloud API groups, the management side (BL-094 phases 1 and 2; docs/specs/waba-groups-management.md sections 9 and 14).
 * Shapes that cross the network between the API and the Groups screen. A group belongs to ONE connected number (`/v2/waba/numbers/:id`).
 *
 * The web branches on the problem+json `code` (WABA_GROUP_ERROR_CODES), never on the message text. The invite link is a bearer secret and the
 * numbers of people asking to join are personal data: the link goes to `waba.groups.read`, the numbers only to `waba.groups.manage`.
 */
import { z } from 'zod';

/** Meta's limits (docs/specs section 6): the subject is trimmed and cut at 128 characters, the description at 2,048, a removal takes 8. */
export const WABA_GROUP_SUBJECT_MAX = 128;
export const WABA_GROUP_DESCRIPTION_MAX = 2048;
export const WABA_GROUP_REMOVE_MAX = 8;

export const WABA_GROUP_JOIN_MODES = ['auto_approve', 'approval_required'] as const;
export const wabaGroupJoinModeSchema = z.enum(WABA_GROUP_JOIN_MODES);
export type WabaGroupJoinMode = z.infer<typeof wabaGroupJoinModeSchema>;

/** The codes the groups routes answer with (the registry itself lives in `errors.ts`). */
export const WABA_GROUP_ERROR_CODES = [
  'WABA_GROUPS_NOT_ELIGIBLE',
  'WABA_GROUPS_PROVIDER_UNSUPPORTED',
  'WABA_GROUP_NOT_FOUND',
  'WABA_GROUP_SUSPENDED',
  'WABA_GROUP_LIMIT_REACHED',
  'WABA_GROUP_RATE_LIMITED',
  'WABA_GROUP_META_REJECTED',
] as const;
export type WabaGroupErrorCode = (typeof WABA_GROUP_ERROR_CODES)[number];

/** `GET .../groups/state`. "Not eligible" is a normal answer here, not an error. */
export const WABA_GROUPS_STATE_REASONS = [
  'eligible',
  /** Meta answered 131215: the number is not an Official Business Account (or is on the Business app). */
  'not_eligible',
  /** The number is reached through Interakt or a registry provider: Groups is not verified to pass through there (spec 10). */
  'provider_unsupported',
  /** The number is disconnected. */
  'not_connected',
  /** No token stored for the number. */
  'missing_credentials',
  /** Meta could not be asked (network, rate limit): not cached, ask again. */
  'check_failed',
] as const;
export const wabaGroupsStateSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(WABA_GROUPS_STATE_REASONS),
  /** `meta`, `interakt`, or the registry provider's key. */
  provider: z.string(),
  /** What connect/health stored from Meta (`is_official_business_account`); a hint only, the probe is the authority. */
  officialBusinessAccount: z.boolean().nullable(),
});
export type WabaGroupsState = z.infer<typeof wabaGroupsStateSchema>;

/** One person waiting to be let in. Only a holder of `waba.groups.manage` receives these. */
export const wabaGroupJoinRequestSchema = z.object({
  /** Meta's join request id (what approve and reject take). */
  id: z.string(),
  waId: z.string(),
  createdAt: z.string().nullable(),
});
export type WabaGroupJoinRequest = z.infer<typeof wabaGroupJoinRequestSchema>;

export const wabaGroupSchema = z.object({
  id: z.string().uuid(),
  /** Meta's opaque group id. */
  groupId: z.string(),
  subject: z.string().nullable(),
  description: z.string().nullable(),
  inviteLink: z.string().nullable(),
  /** Meta sends the link on a webhook moments after create: no link yet is a real state, not an error. */
  awaitingInviteLink: z.boolean(),
  joinApprovalMode: wabaGroupJoinModeSchema.nullable(),
  participantCount: z.number().int(),
  suspended: z.boolean(),
  pendingJoinRequestCount: z.number().int(),
  /** Empty for a caller without `waba.groups.manage`; the count above is still true. */
  pendingJoinRequests: z.array(wabaGroupJoinRequestSchema),
  /** The creation error Meta reported on the lifecycle webhook, if any. */
  lastError: z.object({ code: z.number().nullable(), message: z.string().nullable() }).nullable(),
  syncedAt: z.string().nullable(),
  createdAt: z.string(),
  rowVersion: z.number().int(),
});
export type WabaGroup = z.infer<typeof wabaGroupSchema>;

export const wabaGroupStatsSchema = z.object({
  groups: z.number().int(),
  members: z.number().int(),
  joinRequests: z.number().int(),
  suspended: z.number().int(),
});
export type WabaGroupStats = z.infer<typeof wabaGroupStatsSchema>;

/** `GET .../groups?limit=&cursor=`: newest first. `stats` covers every group of the number, not only the page. */
export const wabaGroupListSchema = z.object({
  items: z.array(wabaGroupSchema),
  stats: wabaGroupStatsSchema,
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type WabaGroupList = z.infer<typeof wabaGroupListSchema>;

export const wabaGroupListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
});
export type WabaGroupListQuery = z.infer<typeof wabaGroupListQuerySchema>;

export const wabaGroupsStateQuerySchema = z.object({
  /** `1`: ask Meta again instead of using the cached answer (the "reload" of the not-eligible page). */
  fresh: z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export type WabaGroupsStateQuery = z.infer<typeof wabaGroupsStateQuerySchema>;

/** `POST .../groups`. The subject is trimmed; Meta treats an omitted mode as `auto_approve`. */
export const createWabaGroupInputSchema = z.object({
  subject: z.string().trim().min(1).max(WABA_GROUP_SUBJECT_MAX),
  description: z.string().trim().max(WABA_GROUP_DESCRIPTION_MAX).optional(),
  joinApprovalMode: wabaGroupJoinModeSchema.optional(),
});
export type CreateWabaGroupInput = z.infer<typeof createWabaGroupInputSchema>;

/** `PATCH .../groups/:gid`: at least one field; Meta confirms each on a webhook, so the answer is 202 and the row is not changed here. */
export const updateWabaGroupInputSchema = z
  .object({
    subject: z.string().trim().min(1).max(WABA_GROUP_SUBJECT_MAX).optional(),
    description: z.string().trim().max(WABA_GROUP_DESCRIPTION_MAX).optional(),
  })
  .refine((v) => v.subject !== undefined || v.description !== undefined, {
    message: 'Send a subject, a description, or both',
  });
export type UpdateWabaGroupInput = z.infer<typeof updateWabaGroupInputSchema>;

export const wabaGroupUpdateAcceptedSchema = z.object({ accepted: z.literal(true) });
export type WabaGroupUpdateAccepted = z.infer<typeof wabaGroupUpdateAcceptedSchema>;

/** `POST .../groups/:gid/join-requests` */
export const handleWabaGroupJoinRequestsInputSchema = z.object({
  action: z.enum(['approve', 'reject']),
  ids: z.array(z.string().min(1).max(200)).min(1).max(100),
});
export type HandleWabaGroupJoinRequestsInput = z.infer<
  typeof handleWabaGroupJoinRequestsInputSchema
>;
export const wabaGroupJoinRequestsResultSchema = z.object({
  ok: z.literal(true),
  handled: z.number().int(),
});
export type WabaGroupJoinRequestsResult = z.infer<typeof wabaGroupJoinRequestsResultSchema>;

/** `DELETE .../groups/:gid/participants`: Meta takes at most 8 per call. */
export const removeWabaGroupParticipantsInputSchema = z.object({
  participants: z.array(z.string().min(1).max(64)).min(1).max(WABA_GROUP_REMOVE_MAX),
});
export type RemoveWabaGroupParticipantsInput = z.infer<
  typeof removeWabaGroupParticipantsInputSchema
>;
export const wabaGroupParticipantsRemovedSchema = z.object({
  ok: z.literal(true),
  removed: z.number().int(),
});
export type WabaGroupParticipantsRemoved = z.infer<typeof wabaGroupParticipantsRemovedSchema>;

/** `GET .../groups/:gid/participants`: read from Meta on demand and never stored (personal data). Needs `waba.groups.manage`. */
export const wabaGroupMembersSchema = z.object({
  members: z.array(z.object({ waId: z.string() })),
  /** Meta's `total_participant_count`; it leaves the business itself out. */
  total: z.number().int(),
});
export type WabaGroupMembers = z.infer<typeof wabaGroupMembersSchema>;

/** `GET /v2/waba/numbers/:id/group-count` (needs `waba.numbers.manage`): the group records that removing the number deletes (decision D6). */
export const wabaNumberGroupCountSchema = z.object({ count: z.number().int() });
export type WabaNumberGroupCount = z.infer<typeof wabaNumberGroupCountSchema>;

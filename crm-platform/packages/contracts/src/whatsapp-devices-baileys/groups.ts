/**
 * Groups of a PERSONAL WhatsApp number (the unofficial engine, channel kind `whatsapp_qr`): docs/threadwise-port/plan/whatsapp-personal-groups-build.md,
 * docs/threadwise-port/inventory/whatsapp-personal-groups.md. Shapes that cross the network between the API and the Groups tab of `/devices`.
 * A group belongs to ONE device (`devices.uuid`). The group id is the BARE id, without `@g.us` (the inbox thread key is `g:<groupId>`).
 *
 * Every route first runs the unofficial-engine gate (422 WA_UNOFFICIAL_DISABLED). The web branches on the problem+json `code`
 * (WA_GROUP_ERROR_CODES), never on the message text. The invite link is a bearer secret and a member's number is personal data: neither is
 * ever in a list row. The invite link is read by `wa.groups.manage` (`GET .../invite-link`); members and join requests only by `wa.groups.manage`.
 *
 * Permissions: `wa.groups.read` (list, detail, state), `wa.groups.create`, `wa.groups.manage` (members, subject, description, settings,
 * picture, join requests, invite link, join by link), `wa.groups.leave`. There is no plan feature (decision D1).
 */
import { z } from 'zod';
import { uuidSchema, phoneSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';

// --- limits ---------------------------------------------------------------------------------------------------------------

/** Reference's caps (decision D12). */
export const WA_DEVICE_GROUP_SUBJECT_MAX = 60;
export const WA_DEVICE_GROUP_DESCRIPTION_MAX = 512;
/** Ban-safety: people added, removed, promoted or demoted in ONE call (decision D11). */
export const WA_DEVICE_GROUP_PARTICIPANTS_PER_CALL_MAX = 20;
export const WA_DEVICE_GROUP_REMOVE_MAX = 20;
/** Join requests approved or rejected in one call. */
export const WA_DEVICE_GROUP_JOIN_REQUESTS_PER_CALL_MAX = 50;
/** The group picture: JPEG or PNG, at most 5 MB (square preview in the UI). */
export const WA_DEVICE_GROUP_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
export const WA_DEVICE_GROUP_PICTURE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
/** The roster is cached up to this many members on the directory row (the column check allows 2048). */
export const WA_DEVICE_GROUP_ROSTER_CACHE_MAX = 1024;
/** Members shown on a list row (names and roles only, never numbers). */
export const WA_DEVICE_GROUP_PREVIEW_MAX = 5;
/** Mentions on one group message. */
export const WA_DEVICE_GROUP_MENTIONS_MAX = 50;

/** Default per-device limits (decision D11); the env names and the way they are read are in the plan's "Phase A seams". */
export const WA_DEVICE_GROUP_LIMIT_DEFAULTS = {
  /** Every group operation (read or write that reaches WhatsApp). */
  opsPerMinute: 20,
  opsPerDay: 200,
  createsPerDay: 5,
  joinByLinkPerDay: 5,
  /** Seconds the device's group operations are refused after a refusal that looks like a limit or ban signal. */
  cooldownSeconds: 600,
  participantsPerCall: WA_DEVICE_GROUP_PARTICIPANTS_PER_CALL_MAX,
} as const;

// --- error codes ------------------------------------------------------------------------------------------------------------

/** Spread into ERROR_CODES (common/errors.ts) by `whatsapp-devices-baileys/errors.ts`. HTTP status in the comment. */
export const WA_GROUP_ERROR_CODES = {
  /** WhatsApp refused: the connected number is not an admin of this group (403). */
  WA_GROUP_NOT_ADMIN: 'WA_GROUP_NOT_ADMIN',
  /** The group is not in this workspace and number, or WhatsApp says it is gone (404). */
  WA_GROUP_NOT_FOUND: 'WA_GROUP_NOT_FOUND',
  /** The number is not connected, or no worker holds it right now: connect or wait (409). */
  WA_GROUP_DEVICE_NOT_READY: 'WA_GROUP_DEVICE_NOT_READY',
  /** Our per-device ban-safety throttle, a daily cap, or the cooldown after a refusal (429). `errors[]` carries `retryAfterS` and `scope`. */
  WA_GROUP_RATE_LIMITED: 'WA_GROUP_RATE_LIMITED',
  /** WhatsApp says the group is full or the number cannot be in more groups (422). */
  WA_GROUP_LIMIT_REACHED: 'WA_GROUP_LIMIT_REACHED',
  /** The number left, or was removed from, this group: it is read-only (409). */
  WA_GROUP_LEFT: 'WA_GROUP_LEFT',
  /** A number in the request is not a valid phone number, or is the connected number itself (422). `errors[]` lists the numbers. */
  WA_GROUP_INVALID_NUMBER: 'WA_GROUP_INVALID_NUMBER',
  /** The invite link or code is malformed, expired, revoked or the group is gone (422). */
  WA_GROUP_JOIN_LINK_INVALID: 'WA_GROUP_JOIN_LINK_INVALID',
  /** Joining by link is switched off on this platform (env) (422). */
  WA_GROUP_JOIN_BY_LINK_DISABLED: 'WA_GROUP_JOIN_BY_LINK_DISABLED',
  /** A non-admin number tried to send in an admins-only group; refused before any WhatsApp call (422, non-retryable). */
  WA_GROUP_ANNOUNCE_ONLY: 'WA_GROUP_ANNOUNCE_ONLY',
  /** WhatsApp refused for another reason or did not answer; the message is operator wording (502). */
  WA_GROUP_UNAVAILABLE: 'WA_GROUP_UNAVAILABLE',
} as const;
export type WaGroupErrorCode = (typeof WA_GROUP_ERROR_CODES)[keyof typeof WA_GROUP_ERROR_CODES];

/** What the throttle refused on (`errors[].scope` of WA_GROUP_RATE_LIMITED). */
export const WA_GROUP_RATE_SCOPES = [
  'ops_minute',
  'ops_day',
  'creates_day',
  'join_link_day',
  'cooldown',
] as const;
export const waGroupRateScopeSchema = z.enum(WA_GROUP_RATE_SCOPES);
export type WaGroupRateScope = z.infer<typeof waGroupRateScopeSchema>;

// --- outbox and realtime ----------------------------------------------------------------------------------------------------

/**
 * Outbox event types (aggregateModule `whatsapp-devices-baileys`, aggregateId the `wa_device_groups.id`). Payloads carry ids and the kind of
 * change only: never a member's number, the subject or the invite code.
 */
export const WA_DEVICE_GROUP_EVENTS = {
  created: 'whatsapp.device_group.created',
  updated: 'whatsapp.device_group.updated',
  /** The number left, or was removed (payload `{ removed: boolean }`: true when someone else removed it). */
  left: 'whatsapp.device_group.left',
  /** Someone asked to join (payload `{ pending: number }`). */
  joinRequest: 'whatsapp.device_group.join_request',
  participantsChanged: 'whatsapp.device_group.participants_changed',
} as const;
export type WaDeviceGroupEventType =
  (typeof WA_DEVICE_GROUP_EVENTS)[keyof typeof WA_DEVICE_GROUP_EVENTS];

/** The `kind` of the realtime event `whatsapp.device_group.changed` (the outbox name without its prefix). */
export const WA_DEVICE_GROUP_CHANGE_KINDS = [
  'created',
  'updated',
  'left',
  'join_request',
  'participants_changed',
] as const;
export const waDeviceGroupChangeKindSchema = z.enum(WA_DEVICE_GROUP_CHANGE_KINDS);
export type WaDeviceGroupChangeKind = z.infer<typeof waDeviceGroupChangeKindSchema>;

// --- the group ----------------------------------------------------------------------------------------------------------------

export const WA_GROUP_MEMBER_ADD_MODES = ['all_member_add', 'admin_add'] as const;
export const waGroupMemberAddModeSchema = z.enum(WA_GROUP_MEMBER_ADD_MODES);
export type WaGroupMemberAddMode = z.infer<typeof waGroupMemberAddModeSchema>;

export const waGroupAdminRoleSchema = z.enum(['superadmin', 'admin']);
export type WaGroupAdminRole = z.infer<typeof waGroupAdminRoleSchema>;

/** A member as listed on a row: a display name and a role, never a number. */
export const waDeviceGroupPreviewMemberSchema = z.object({
  name: z.string().nullable(),
  admin: waGroupAdminRoleSchema.nullable(),
});
export type WaDeviceGroupPreviewMember = z.infer<typeof waDeviceGroupPreviewMemberSchema>;

/** One group of a number. No invite code, no member numbers, no join request numbers. */
export const waDeviceGroupSchema = z.object({
  id: uuidSchema,
  /** `devices.uuid` of the number this group belongs to. */
  deviceId: uuidSchema,
  /** The bare group id (no `@g.us`). */
  groupId: z.string(),
  subject: z.string().nullable(),
  description: z.string().nullable(),
  /** Members, as WhatsApp last said. */
  size: z.number().int().nonnegative(),
  /** Is OUR number an admin: every change needs it. */
  isAdmin: z.boolean(),
  /** Only admins may send. */
  announce: z.boolean(),
  /** Only admins may edit the group info (subject, description, picture). */
  restrict: z.boolean(),
  /** New members need an admin's approval. */
  joinApproval: z.boolean(),
  memberAddMode: waGroupMemberAddModeSchema,
  /** An invite code is held (we are admin and it was read). The code itself is read with `GET .../invite-link`. */
  hasInviteLink: z.boolean(),
  pictureUrl: z.string().nullable(),
  participantsPreview: z.array(waDeviceGroupPreviewMemberSchema).max(WA_DEVICE_GROUP_PREVIEW_MAX),
  participantsCount: z.number().int().nonnegative(),
  pendingRequestCount: z.number().int().nonnegative(),
  /** The inbox conversation of this group, when it has one. */
  conversationId: uuidSchema.nullable(),
  /** When WhatsApp created the group. */
  groupCreatedAt: z.string().nullable(),
  /** When the row was made here (the list order). */
  createdAt: z.string(),
  syncedAt: z.string().nullable(),
  /** The number left or was removed: the group is kept, read-only. */
  left: z.boolean(),
  leftAt: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type WaDeviceGroup = z.infer<typeof waDeviceGroupSchema>;

export const waDeviceGroupStatsSchema = z.object({
  groups: z.number().int(),
  members: z.number().int(),
  joinRequests: z.number().int(),
  /** Groups where our number is an admin. */
  admin: z.number().int(),
  left: z.number().int(),
});
export type WaDeviceGroupStats = z.infer<typeof waDeviceGroupStatsSchema>;

/** `GET /v2/wa-groups?deviceId=&limit=&cursor=`: newest first by keyset (created_at, id). `stats` covers every group of the number. */
export const waDeviceGroupListQuerySchema = z.object({
  deviceId: uuidSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  /** Part of the subject. */
  q: z.string().trim().min(1).max(100).optional(),
  /** `active` hides groups the number left, `left` shows only those. */
  status: z.enum(['all', 'active', 'left']).default('all'),
});
export type WaDeviceGroupListQuery = z.infer<typeof waDeviceGroupListQuerySchema>;

export const waDeviceGroupListSchema = z.object({
  items: z.array(waDeviceGroupSchema),
  stats: waDeviceGroupStatsSchema,
  page: pageInfoSchema,
});
export type WaDeviceGroupList = z.infer<typeof waDeviceGroupListSchema>;

// --- state and limits -------------------------------------------------------------------------------------------------------

/** One counter of the per-device limiter. `remaining` never goes below 0; `resetsAt` is an ISO time or null when nothing was used. */
export const waGroupLimitCounterSchema = z.object({
  limit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetsAt: z.string().nullable(),
});
export type WaGroupLimitCounter = z.infer<typeof waGroupLimitCounterSchema>;

export const waGroupLimitsSchema = z.object({
  opsPerMinute: waGroupLimitCounterSchema,
  opsPerDay: waGroupLimitCounterSchema,
  createsPerDay: waGroupLimitCounterSchema,
  joinByLinkPerDay: waGroupLimitCounterSchema,
  /** Set while the number is cooling down after a refusal that looked like a limit or ban signal. */
  cooldownUntil: z.string().nullable(),
  participantsPerCall: z.number().int(),
});
export type WaGroupLimits = z.infer<typeof waGroupLimitsSchema>;

export const WA_GROUPS_STATE_REASONS = [
  'ready',
  /** The number is not connected (scan again, or wait). */
  'not_connected',
  /** The number is connected but no worker holds its session right now. */
  'worker_unavailable',
] as const;

/** `GET /v2/wa-groups/state?deviceId=`: whether the Groups tab can act for this number, and what is left of the limits. */
export const waDeviceGroupsStateSchema = z.object({
  deviceId: uuidSchema,
  connected: z.boolean(),
  reason: z.enum(WA_GROUPS_STATE_REASONS),
  limits: waGroupLimitsSchema,
  /** Joining by invite link is switched on for this platform (off by default). */
  joinByLinkEnabled: z.boolean(),
  /** When the directory was last read from WhatsApp for this number. */
  lastSyncedAt: z.string().nullable(),
});
export type WaDeviceGroupsState = z.infer<typeof waDeviceGroupsStateSchema>;

// --- writes ----------------------------------------------------------------------------------------------------------------

/** A phone number the API turns into a participant id: E.164, at most 20 per call. */
const numbersSchema = z.array(phoneSchema).min(1).max(WA_DEVICE_GROUP_PARTICIPANTS_PER_CALL_MAX);

const subjectSchema = z.string().trim().min(1).max(WA_DEVICE_GROUP_SUBJECT_MAX);
const descriptionSchema = z.string().trim().max(WA_DEVICE_GROUP_DESCRIPTION_MAX);

/** `POST /v2/wa-groups`. The numbers are the first members (WhatsApp adds our own number itself; do not list it). Needs `wa.groups.create`. */
export const createWaDeviceGroupInputSchema = z.object({
  deviceId: uuidSchema,
  subject: subjectSchema,
  description: descriptionSchema.optional(),
  numbers: numbersSchema,
  /** The person confirmed the ban-risk dialog (create is a risky action). */
  acknowledgeRisk: z.literal(true),
});
export type CreateWaDeviceGroupInput = z.infer<typeof createWaDeviceGroupInputSchema>;

export const createWaDeviceGroupResultSchema = z.object({
  group: waDeviceGroupSchema,
  /** What happened to each number (privacy settings may refuse some). */
  participants: z.lazy(() => waGroupParticipantResultsSchema),
  /** The description is a second best-effort call: false when it could not be set although the group exists. */
  descriptionSet: z.boolean(),
});
export type CreateWaDeviceGroupResult = z.infer<typeof createWaDeviceGroupResultSchema>;

/**
 * `PATCH /v2/wa-groups/:id`: at least one field. The answer is the group as it is after the change (the call is synchronous over the
 * worker, unlike the official groups). `picture` is not here: it is `PUT .../picture`.
 */
export const updateWaDeviceGroupInputSchema = z
  .object({
    subject: subjectSchema.optional(),
    description: descriptionSchema.optional(),
    announce: z.boolean().optional(),
    restrict: z.boolean().optional(),
    joinApproval: z.boolean().optional(),
    memberAddMode: waGroupMemberAddModeSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateWaDeviceGroupInput = z.infer<typeof updateWaDeviceGroupInputSchema>;

/** `PUT /v2/wa-groups/:id/picture` (multipart, field `file`). The answer is the group. A non-image or one over the cap is 422. */
export const waDeviceGroupPictureMetaSchema = z.object({
  mimeType: z.enum(WA_DEVICE_GROUP_PICTURE_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(WA_DEVICE_GROUP_PICTURE_MAX_BYTES),
});
export type WaDeviceGroupPictureMeta = z.infer<typeof waDeviceGroupPictureMetaSchema>;

// --- participants ----------------------------------------------------------------------------------------------------------

/** `POST /v2/wa-groups/:id/participants/{add|remove|promote|demote}`. */
export const WA_GROUP_PARTICIPANT_ACTIONS = ['add', 'remove', 'promote', 'demote'] as const;
export const waGroupParticipantActionSchema = z.enum(WA_GROUP_PARTICIPANT_ACTIONS);
export type WaGroupParticipantAction = z.infer<typeof waGroupParticipantActionSchema>;

export const waGroupParticipantsInputSchema = z.object({ numbers: numbersSchema });
export type WaGroupParticipantsInput = z.infer<typeof waGroupParticipantsInputSchema>;
export const addWaGroupParticipantsInputSchema = waGroupParticipantsInputSchema;
export const removeWaGroupParticipantsInputSchema = z.object({
  numbers: z.array(phoneSchema).min(1).max(WA_DEVICE_GROUP_REMOVE_MAX),
});
export const promoteWaGroupParticipantsInputSchema = waGroupParticipantsInputSchema;
export const demoteWaGroupParticipantsInputSchema = waGroupParticipantsInputSchema;

/** What became of one person. `ok` is done; the rest are the reasons WhatsApp gives, so the UI can say what to do. */
export const WA_GROUP_PARTICIPANT_OUTCOMES = [
  'ok',
  'already_member',
  'not_member',
  'not_on_whatsapp',
  /** Their privacy settings do not let this number add them: send the invite link instead. */
  'privacy_blocked',
  'not_allowed',
  'group_full',
  'failed',
] as const;
export const waGroupParticipantOutcomeSchema = z.enum(WA_GROUP_PARTICIPANT_OUTCOMES);
export type WaGroupParticipantOutcome = z.infer<typeof waGroupParticipantOutcomeSchema>;

export const waGroupParticipantResultSchema = z.object({
  /** The number as sent (E.164) when it was a number, else null (a member removed by id). */
  number: z.string().nullable(),
  outcome: waGroupParticipantOutcomeSchema,
  /** WhatsApp's status code for the person (`200`, `403`, `408`, `409`...), for support; not for branching. */
  code: z.string().nullable(),
});
export type WaGroupParticipantResult = z.infer<typeof waGroupParticipantResultSchema>;

/** The answer of a participants call. Partial success is a success, and so is "nobody could be added" (the reasons are in `results`); refusals before WhatsApp (not admin, limits, left) are 4xx with the group error code. */
export const waGroupParticipantResultsSchema = z.object({
  okCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  results: z.array(waGroupParticipantResultSchema),
});
export type WaGroupParticipantResults = z.infer<typeof waGroupParticipantResultsSchema>;

/** A member in the manage view. Needs `wa.groups.manage`: it carries numbers. */
export const waDeviceGroupMemberSchema = z.object({
  /** WhatsApp's id for the member (`...@s.whatsapp.net` or `...@lid`). What a mention or a removal by id takes. */
  jid: z.string(),
  /** E.164 when known; a member addressed only by an anonymous id has none. */
  phone: z.string().nullable(),
  name: z.string().nullable(),
  admin: waGroupAdminRoleSchema.nullable(),
  /** This member is our own number. */
  self: z.boolean(),
});
export type WaDeviceGroupMember = z.infer<typeof waDeviceGroupMemberSchema>;

/** `GET /v2/wa-groups/:id/participants?limit=&cursor=&q=`: paged from the cached roster; `q` matches name or number. */
export const waDeviceGroupMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type WaDeviceGroupMembersQuery = z.infer<typeof waDeviceGroupMembersQuerySchema>;
export const waDeviceGroupMembersSchema = z.object({
  members: z.array(waDeviceGroupMemberSchema),
  total: z.number().int().nonnegative(),
  page: pageInfoSchema,
});
export type WaDeviceGroupMembers = z.infer<typeof waDeviceGroupMembersSchema>;

// --- join requests ---------------------------------------------------------------------------------------------------------

/** One person waiting to be let in. Only `wa.groups.manage` receives these. */
export const waDeviceGroupJoinRequestSchema = z.object({
  /** WhatsApp's id for the person: what approve and reject take. */
  jid: z.string(),
  phone: z.string().nullable(),
  name: z.string().nullable(),
  requestedAt: z.string().nullable(),
});
export type WaDeviceGroupJoinRequest = z.infer<typeof waDeviceGroupJoinRequestSchema>;
export const waDeviceGroupJoinRequestsSchema = z.object({
  requests: z.array(waDeviceGroupJoinRequestSchema),
});
export type WaDeviceGroupJoinRequests = z.infer<typeof waDeviceGroupJoinRequestsSchema>;

/** `POST /v2/wa-groups/:id/join-requests`. `jids` are the `jid` of the requests. */
export const handleWaDeviceGroupJoinRequestsInputSchema = z.object({
  action: z.enum(['approve', 'reject']),
  jids: z.array(z.string().min(1).max(100)).min(1).max(WA_DEVICE_GROUP_JOIN_REQUESTS_PER_CALL_MAX),
});
export type HandleWaDeviceGroupJoinRequestsInput = z.infer<
  typeof handleWaDeviceGroupJoinRequestsInputSchema
>;
export const waDeviceGroupJoinRequestsResultSchema = waGroupParticipantResultsSchema;
export type WaDeviceGroupJoinRequestsResult = z.infer<typeof waDeviceGroupJoinRequestsResultSchema>;

// --- invite link and joining -----------------------------------------------------------------------------------------------

/** `GET /v2/wa-groups/:id/invite-link` and `POST .../invite-link/reset`. A bearer secret: `wa.groups.manage`, never logged, never in audit. */
export const waDeviceGroupInviteLinkSchema = z.object({
  code: z.string(),
  url: z.string().url(),
});
export type WaDeviceGroupInviteLink = z.infer<typeof waDeviceGroupInviteLinkSchema>;

export const WA_GROUP_INVITE_URL_PREFIX = 'https://chat.whatsapp.com/';
/** Letters and digits only (WhatsApp's own codes are 22 characters; kept loose so a format change does not break joins). */
const INVITE_CODE_RE = /^[A-Za-z0-9]{10,40}$/;

/** The code of a `chat.whatsapp.com` link, or of a bare code; null when it is neither. */
export function parseWaGroupInviteCode(input: string): string | null {
  const t = input.trim();
  const m = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]+)\/?(?:\?.*)?$/i.exec(
    t,
  );
  const code = m ? m[1]! : t;
  return INVITE_CODE_RE.test(code) ? code : null;
}

const inviteInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .transform((v, ctx) => {
    const code = parseWaGroupInviteCode(v);
    if (!code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a WhatsApp invite link or code' });
      return z.NEVER;
    }
    return code;
  });

/** `POST /v2/wa-groups/join-preview`: what the link points at, without joining. Needs `wa.groups.manage`; counts toward the join-by-link cap. */
export const waDeviceGroupJoinPreviewInputSchema = z.object({
  deviceId: uuidSchema,
  /** A `chat.whatsapp.com` link or the bare code; the schema's output is the bare code. */
  invite: inviteInputSchema,
});
export type WaDeviceGroupJoinPreviewInput = z.infer<typeof waDeviceGroupJoinPreviewInputSchema>;
export const waDeviceGroupJoinPreviewSchema = z.object({
  subject: z.string().nullable(),
  size: z.number().int().nonnegative().nullable(),
  /** The number is already in this group. */
  alreadyMember: z.boolean(),
  /** Joining needs an admin's approval (it becomes a request). */
  approvalRequired: z.boolean(),
});
export type WaDeviceGroupJoinPreview = z.infer<typeof waDeviceGroupJoinPreviewSchema>;

/** `POST /v2/wa-groups/join`. Own cap (highest ban risk), `acknowledgeRisk` required, off unless the platform enables it. */
export const waDeviceGroupJoinInputSchema = z.object({
  deviceId: uuidSchema,
  invite: inviteInputSchema,
  acknowledgeRisk: z.literal(true),
});
export type WaDeviceGroupJoinInput = z.infer<typeof waDeviceGroupJoinInputSchema>;
export const waDeviceGroupJoinResultSchema = z.object({
  /** `joined`: the group row follows within seconds; `requested`: an admin must approve first. */
  status: z.enum(['joined', 'requested']),
  group: waDeviceGroupSchema.nullable(),
});
export type WaDeviceGroupJoinResult = z.infer<typeof waDeviceGroupJoinResultSchema>;

// --- leaving ---------------------------------------------------------------------------------------------------------------

/** `POST /v2/wa-groups/:id/leave`: needs `wa.groups.leave`. Cannot be undone from here. The group is kept, read-only (decision D5). */
export const leaveWaDeviceGroupInputSchema = z.object({ confirm: z.literal(true) });
export type LeaveWaDeviceGroupInput = z.infer<typeof leaveWaDeviceGroupInputSchema>;

// --- messages --------------------------------------------------------------------------------------------------------------

/** A member @mentioned in a message sent into a group thread (`mentions` of the text send; `jid` as listed by `GET .../participants`). */
export const waGroupMentionSchema = z.object({
  jid: z.string().min(1).max(100),
  /** The name shown in the typed `@name` token; informational. */
  name: z.string().max(100).optional(),
});
export type WaGroupMention = z.infer<typeof waGroupMentionSchema>;

// --- the device-scoped routes (the API as built) ------------------------------------------------------------------------------

/**
 * The API addresses a group by its number in the PATH (`/v2/devices/:id/groups/...`, `:id` = `devices.uuid`), so the bodies and queries of
 * the routes below drop the `deviceId` field the schemas above carry (it stays in them for clients that send it in the body).
 */
export const waDeviceGroupListByDeviceQuerySchema = waDeviceGroupListQuerySchema.omit({
  deviceId: true,
});
export type WaDeviceGroupListByDeviceQuery = z.infer<typeof waDeviceGroupListByDeviceQuerySchema>;
export const createWaDeviceGroupBodySchema = createWaDeviceGroupInputSchema.omit({
  deviceId: true,
});
export type CreateWaDeviceGroupBody = z.infer<typeof createWaDeviceGroupBodySchema>;
export const waDeviceGroupJoinPreviewBodySchema = waDeviceGroupJoinPreviewInputSchema.omit({
  deviceId: true,
});
export type WaDeviceGroupJoinPreviewBody = z.infer<typeof waDeviceGroupJoinPreviewBodySchema>;
export const waDeviceGroupJoinBodySchema = waDeviceGroupJoinInputSchema.omit({ deviceId: true });
export type WaDeviceGroupJoinBody = z.infer<typeof waDeviceGroupJoinBodySchema>;

/**
 * `GET /v2/devices/:id/groups/:gid/join-requests?fresh=1`: the cached queue by default; `fresh` asks WhatsApp now (one counted group
 * operation), the recovery path when a `group.join-request` event was missed.
 */
export const waDeviceGroupJoinRequestsQuerySchema = z.object({
  fresh: z
    .union([z.boolean(), z.enum(['1', '0', 'true', 'false'])])
    .optional()
    .transform((v) => v === true || v === '1' || v === 'true'),
});
export type WaDeviceGroupJoinRequestsQuery = z.infer<typeof waDeviceGroupJoinRequestsQuerySchema>;

/** `POST /v2/devices/:id/groups/:gid/participants`: add, promote or demote people (removing is `DELETE`). Up to 20 numbers. */
export const changeWaGroupParticipantsInputSchema = z.object({
  action: z.enum(['add', 'promote', 'demote']),
  numbers: numbersSchema,
});
export type ChangeWaGroupParticipantsInput = z.infer<typeof changeWaGroupParticipantsInputSchema>;

/** `POST /v2/devices/:id/groups/sync`: read the whole group list from WhatsApp now (counted, and at most once a minute per number). */
export const waDeviceGroupsSyncResultSchema = z.object({
  /** Groups the number is in after the read. */
  groups: z.number().int().nonnegative(),
  /** Groups newly found to be left by this read. */
  left: z.number().int().nonnegative(),
  /** The read was skipped because one ran in the last minute; nothing was asked of WhatsApp. */
  throttled: z.boolean(),
});
export type WaDeviceGroupsSyncResult = z.infer<typeof waDeviceGroupsSyncResultSchema>;

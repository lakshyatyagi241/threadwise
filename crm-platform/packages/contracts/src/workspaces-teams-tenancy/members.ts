import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { trimEdges } from '../common/trim-edges';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Workspace members (TW-WSP-015..021, 046): who is in this workspace, with which role, and the invite / role / remove /
 * reset actions on them. Reference's five tiers are the RBAC domain's five workspace presets, read from the member's roles by
 * the preset's `system_key`: `owner` = the Owner preset (`admin`), `admin` = `workspace_admin`, then `manager`, `agent`
 * and `viewer`; a role an organization defined itself (no `system_key`) reads as `custom`. A member's tier is the highest
 * of their roles, and `isOwner` is true when they hold the Owner preset.
 */
export const WSP_ROLE_TIERS = ['owner', 'admin', 'manager', 'agent', 'viewer', 'custom'] as const;
export const wspRoleTierSchema = z.enum(WSP_ROLE_TIERS);
export type WspRoleTier = z.infer<typeof wspRoleTierSchema>;

/**
 * Rank of a tier, used for "may this person act on that person" checks (TW-WSP-020 rule 4, 046). The numbers are the RBAC
 * domain's `PRESET_RANK` (a unit test keeps them equal); a custom role has no rank there, so it ranks below every preset.
 */
export const WSP_TIER_RANK: Record<WspRoleTier, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  agent: 40,
  viewer: 20,
  custom: 0,
};

export const WSP_MEMBER_NAME_MAX = 191;

const HIDDEN_EDGE = /^[\s\u200B-\u200D\u2060\uFEFF]$/;

/**
 * A display name (member, team) with whitespace AND invisible formatting characters (zero-width space, joiners, word
 * joiner, byte-order mark) removed from both ends, so a name cannot hide behind characters nobody can see.
 */
export const wspDisplayName = (max: number) =>
  z
    .string()
    .transform((v) => trimEdges(v, (c) => HIDDEN_EDGE.test(c)))
    .pipe(z.string().min(1).max(max));
export const WSP_INVITE_TTL_DAYS = 7;

export const wspMemberStatusSchema = z.enum(['active', 'pending', 'inactive']);
export type WspMemberStatus = z.infer<typeof wspMemberStatusSchema>;

export const wspPresenceSchema = z.enum(['online', 'away', 'busy', 'offline']);
export type WspPresence = z.infer<typeof wspPresenceSchema>;

/** Most open chats routing gives one agent at once. The Add member form starts at 4 (Waboo's default); no value = no limit. */
export const WSP_CHAT_LIMIT_DEFAULT = 4;
export const WSP_CHAT_LIMIT_MAX = 1000;
export const wspChatLimitSchema = z.number().int().min(1).max(WSP_CHAT_LIMIT_MAX);

/** A member's phone: E.164, or null/empty for none. Surrounding space is ignored; an empty string clears the number. */
export const wspMemberPhoneSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
  phoneSchema.nullable(),
);

export const wspRoleRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  tier: wspRoleTierSchema,
});
export type WspRoleRef = z.infer<typeof wspRoleRefSchema>;

export const wspMemberSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  /** E.164; null when none is on file. */
  phone: z.string().nullable(),
  /** Most open chats routing gives this agent at once; null = no limit. */
  chatLimit: z.number().int().nullable(),
  tier: wspRoleTierSchema,
  roles: z.array(wspRoleRefSchema),
  isOwner: z.boolean(),
  /** `pending` = invited, link not used yet (joinedAt is null). */
  status: wspMemberStatusSchema,
  presence: wspPresenceSchema,
  lastSeenAt: z.string().datetime().nullable(),
  /** The last time this member signed in (user_security.last_login_at); null = never. Read only. */
  lastLoginAt: z.string().datetime().nullable(),
  invitedAt: z.string().datetime().nullable(),
  joinedAt: z.string().datetime().nullable(),
  teamIds: z.array(uuidSchema),
  rowVersion: z.number().int(),
});
export type WspMember = z.infer<typeof wspMemberSchema>;

export const listWspMembersQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Name or email contains, case-insensitive'),
  tier: wspRoleTierSchema.optional(),
});
export type ListWspMembersQuery = z.infer<typeof listWspMembersQuerySchema>;

/** Role the caller may hand out, and the screen's header numbers. */
export const wspMembersSummarySchema = z.object({
  counts: z.object({
    all: z.number().int(),
    owner: z.number().int(),
    admin: z.number().int(),
    manager: z.number().int(),
    agent: z.number().int(),
    viewer: z.number().int(),
    custom: z.number().int(),
    pending: z.number().int(),
  }),
  roles: z.array(wspRoleRefSchema.extend({ grantable: z.boolean() })),
  /** Seats used (active and pending) and the plan's limit; limit null = unlimited. */
  seats: z.object({ used: z.number().int(), limit: z.number().int().nullable() }),
  /** What this caller may do; the server enforces every one anyway. */
  me: z.object({
    id: uuidSchema,
    tier: wspRoleTierSchema,
    canInvite: z.boolean(),
    canAssignRoles: z.boolean(),
    canManageTeams: z.boolean(),
  }),
});
export type WspMembersSummary = z.infer<typeof wspMembersSummarySchema>;

export const inviteWspMemberSchema = z.object({
  fullName: wspDisplayName(WSP_MEMBER_NAME_MAX),
  email: emailSchema,
  roleId: uuidSchema,
  phone: wspMemberPhoneSchema.optional(),
  chatLimit: wspChatLimitSchema.nullable().optional(),
});
export type InviteWspMemberInput = z.infer<typeof inviteWspMemberSchema>;

export const inviteWspMemberResponseSchema = z.object({
  member: wspMemberSchema,
  /** False when no mail transport is configured; the screen then offers the link to copy. */
  emailSent: z.boolean(),
  /** Present only when the mail could not be sent, so the inviter can hand it over. Never retrievable later. */
  inviteLink: z.string().nullable(),
});
export type InviteWspMemberResponse = z.infer<typeof inviteWspMemberResponseSchema>;

export const changeWspMemberRoleSchema = z.object({
  roleId: uuidSchema,
  rowVersion: z.number().int().positive(),
});
export type ChangeWspMemberRoleInput = z.infer<typeof changeWspMemberRoleSchema>;

/** The Change member dialog: phone and chat limit. `null` clears a value, leaving a key out keeps it. */
export const updateWspMemberDetailsSchema = z
  .object({
    phone: wspMemberPhoneSchema.optional(),
    chatLimit: wspChatLimitSchema.nullable().optional(),
    rowVersion: z.number().int().positive(),
  })
  .refine((v) => v.phone !== undefined || v.chatLimit !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateWspMemberDetailsInput = z.infer<typeof updateWspMemberDetailsSchema>;

/**
 * The caller's own availability, the switch in the top bar. `online` = routing may give this agent chats, `offline` = it
 * never does. A member nobody has switched yet counts as `online`, as routing always read them.
 */
export const WSP_AVAILABILITY = ['online', 'offline'] as const;
export const wspAvailabilitySchema = z.object({ status: z.enum(WSP_AVAILABILITY) });
export type WspAvailability = z.infer<typeof wspAvailabilitySchema>;
export const setWspAvailabilitySchema = wspAvailabilitySchema;
export type SetWspAvailabilityInput = z.infer<typeof setWspAvailabilitySchema>;

export const wspMemberActionResponseSchema = z.object({
  member: wspMemberSchema,
  emailSent: z.boolean(),
  inviteLink: z.string().nullable(),
});
export type WspMemberActionResponse = z.infer<typeof wspMemberActionResponseSchema>;

/** Accepting an invitation: the invitee chooses a password and is signed in (AUTH session response). */
export const acceptWspInviteSchema = z.object({
  token: z.string().min(16).max(256),
  orgSlug: z.string().min(1).max(64),
  password: z.string().min(8).max(255),
});
export type AcceptWspInviteInput = z.infer<typeof acceptWspInviteSchema>;

export const wspInvitePreviewQuerySchema = z.object({
  token: z.string().min(16).max(256),
  orgSlug: z.string().min(1).max(64),
});

export const wspInvitePreviewSchema = z.object({
  workspaceName: z.string(),
  email: z.string(),
  fullName: z.string(),
  roleName: z.string(),
  invitedBy: z.string().nullable(),
});
export type WspInvitePreview = z.infer<typeof wspInvitePreviewSchema>;

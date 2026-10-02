import { z } from 'zod';
import { emailSchema, uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Workspace members (TW-WSP-015..021, 046): who is in this workspace, with which role, and the invite / role / remove /
 * reset actions on them. Reference's five tiers are kept as a display tier computed from the member's roles:
 * `owner` = the organization's owner, then the system presets `admin`, `manager`, `agent`, `viewer`; any role an
 * organization defined itself reads as `custom` and ranks like an agent.
 */
export const WSP_ROLE_TIERS = ['owner', 'admin', 'manager', 'agent', 'viewer', 'custom'] as const;
export const wspRoleTierSchema = z.enum(WSP_ROLE_TIERS);
export type WspRoleTier = z.infer<typeof wspRoleTierSchema>;

/** Rank of a tier, used for "may this person act on that person" checks (TW-WSP-020 rule 4, 046). */
export const WSP_TIER_RANK: Record<WspRoleTier, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  agent: 40,
  custom: 40,
  viewer: 20,
};

export const WSP_MEMBER_NAME_MAX = 191;
export const WSP_INVITE_TTL_DAYS = 7;

export const wspMemberStatusSchema = z.enum(['active', 'pending', 'inactive']);
export type WspMemberStatus = z.infer<typeof wspMemberStatusSchema>;

export const wspPresenceSchema = z.enum(['online', 'away', 'busy', 'offline']);
export type WspPresence = z.infer<typeof wspPresenceSchema>;

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
  tier: wspRoleTierSchema,
  roles: z.array(wspRoleRefSchema),
  isOwner: z.boolean(),
  /** `pending` = invited, link not used yet (joinedAt is null). */
  status: wspMemberStatusSchema,
  presence: wspPresenceSchema,
  lastSeenAt: z.string().datetime().nullable(),
  invitedAt: z.string().datetime().nullable(),
  joinedAt: z.string().datetime().nullable(),
  teamIds: z.array(uuidSchema),
  rowVersion: z.number().int(),
});
export type WspMember = z.infer<typeof wspMemberSchema>;

export const listWspMembersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional().describe('Name or email contains, case-insensitive'),
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
  fullName: z.string().trim().min(1).max(WSP_MEMBER_NAME_MAX),
  email: emailSchema,
  roleId: uuidSchema,
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
